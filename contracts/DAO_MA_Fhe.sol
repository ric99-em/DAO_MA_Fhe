pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract DAOMAFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error BatchClosed();
    error InvalidArgument();
    error ReplayDetected();
    error StateMismatch();
    error DecryptionFailed();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event DataSubmitted(address indexed provider, uint256 indexed batchId, uint256 encryptedValue);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 result);

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    address public owner;
    mapping(address => bool) public providers;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    bool public batchOpen;

    mapping(uint256 => euint32) public encryptedDataSum;
    mapping(uint256 => uint256) public dataCount;
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;

    mapping(uint256 => DecryptionContext) public decryptionContexts;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!providers[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier submissionCooldown(address submitter) {
        if (block.timestamp < lastSubmissionTime[submitter] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier decryptionRequestCooldown(address requester) {
        if (block.timestamp < lastDecryptionRequestTime[requester] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        providers[msg.sender] = true;
        cooldownSeconds = 60; // Default cooldown: 60 seconds
        currentBatchId = 0;
        batchOpen = false;
    }

    function addProvider(address provider) external onlyOwner {
        providers[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        providers[provider] = false;
        emit ProviderRemoved(provider);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == 0) revert InvalidArgument();
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) revert InvalidArgument(); // Batch already open
        currentBatchId++;
        batchOpen = true;
        encryptedDataSum[currentBatchId] = FHE.asEuint32(0);
        dataCount[currentBatchId] = 0;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchNotOpen();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitData(uint256 encryptedValue) external
        onlyProvider
        whenNotPaused
        submissionCooldown(msg.sender)
    {
        if (!batchOpen) revert BatchNotOpen();
        if (hasSubmitted[currentBatchId][msg.sender]) {
            revert InvalidArgument(); // Provider already submitted for this batch
        }

        euint32 memory encryptedVal = FHE.asEuint32(encryptedValue);
        _initIfNeeded(encryptedVal);

        encryptedDataSum[currentBatchId] = encryptedDataSum[currentBatchId].add(encryptedVal);
        dataCount[currentBatchId]++;
        hasSubmitted[currentBatchId][msg.sender] = true;

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit DataSubmitted(msg.sender, currentBatchId, encryptedValue);
    }

    function requestBatchResultDecryption() external
        onlyProvider
        whenNotPaused
        decryptionRequestCooldown(msg.sender)
    {
        if (batchOpen) revert BatchNotClosed(); // Cannot request decryption for an open batch

        if (dataCount[currentBatchId] == 0) {
            revert InvalidArgument(); // No data to decrypt
        }
        _initIfNeeded(encryptedDataSum[currentBatchId]);

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedDataSum[currentBatchId]);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, currentBatchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();

        uint256 batchId = decryptionContexts[requestId].batchId;
        euint32 memory currentEncryptedSum = encryptedDataSum[batchId];
        (bool initialized,) = FHE.isInitialized(currentEncryptedSum);

        if (!initialized) {
            decryptionContexts[requestId].processed = true; // Mark as processed to prevent replay
            revert DecryptionFailed(); // Data not initialized, cannot verify state
        }

        bytes32[] memory currentCts = new bytes32[](1);
        currentCts[0] = FHE.toBytes32(currentEncryptedSum);
        bytes32 currentStateHash = _hashCiphertexts(currentCts);

        if (currentStateHash != decryptionContexts[requestId].stateHash) {
            decryptionContexts[requestId].processed = true; // Mark as processed to prevent replay
            revert StateMismatch();
        }

        try FHE.checkSignatures(requestId, cleartexts, proof) {
            uint256 sum = abi.decode(cleartexts, (uint256));
            decryptionContexts[requestId].processed = true;
            emit DecryptionCompleted(requestId, batchId, sum);
        } catch {
            decryptionContexts[requestId].processed = true; // Mark as processed to prevent replay
            revert DecryptionFailed();
        }
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 memory val) internal {
        (bool initialized, bytes32 pubKey) = FHE.isInitialized(val);
        if (!initialized) {
            FHE.init(val, pubKey);
        }
    }

    function _requireInitialized(euint32 memory val) internal view {
        (bool initialized,) = FHE.isInitialized(val);
        if (!initialized) {
            revert InvalidArgument(); // Ciphertext not initialized
        }
    }
}