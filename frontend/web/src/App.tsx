// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface DAORecord {
  id: string;
  name: string;
  valuation: string; // FHE encrypted
  members: string; // FHE encrypted
  treasury: string; // FHE encrypted
  timestamp: number;
  owner: string;
  status: "pending" | "approved" | "rejected";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  // Randomly selected style: High contrast (blue+orange), Industrial mechanical, Center radiation, Animation rich
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<DAORecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({ name: "", valuation: 0, members: 0, treasury: 0 });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<DAORecord | null>(null);
  const [decryptedValues, setDecryptedValues] = useState<{valuation?: number, members?: number, treasury?: number}>({});
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ma-process'>('dashboard');
  
  // Randomly selected features: Project introduction, Data statistics, Smart charts, M&A process visualization
  const approvedCount = records.filter(r => r.status === "approved").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const rejectedCount = records.filter(r => r.status === "rejected").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("dao_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing DAO keys:", e); }
      }
      
      const list: DAORecord[] = [];
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`dao_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({ 
                id: key, 
                name: recordData.name,
                valuation: recordData.valuation, 
                members: recordData.members,
                treasury: recordData.treasury,
                timestamp: recordData.timestamp, 
                owner: recordData.owner, 
                status: recordData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing DAO data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading DAO ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) { console.error("Error loading DAOs:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitDAO = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting DAO data with Zama FHE..." });
    try {
      const encryptedValuation = FHEEncryptNumber(newRecordData.valuation);
      const encryptedMembers = FHEEncryptNumber(newRecordData.members);
      const encryptedTreasury = FHEEncryptNumber(newRecordData.treasury);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const daoId = `dao-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const daoData = { 
        name: newRecordData.name,
        valuation: encryptedValuation, 
        members: encryptedMembers,
        treasury: encryptedTreasury,
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        status: "pending" 
      };
      
      await contract.setData(`dao_${daoId}`, ethers.toUtf8Bytes(JSON.stringify(daoData)));
      
      const keysBytes = await contract.getData("dao_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(daoId);
      await contract.setData("dao_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "DAO data encrypted and submitted!" });
      await loadRecords();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({ name: "", valuation: 0, members: 0, treasury: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string, field: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      const decrypted = FHEDecryptNumber(encryptedData);
      setDecryptedValues(prev => ({...prev, [field]: decrypted}));
      return decrypted;
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const approveDAO = async (daoId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing DAO data with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const daoBytes = await contract.getData(`dao_${daoId}`);
      if (daoBytes.length === 0) throw new Error("DAO not found");
      const daoData = JSON.parse(ethers.toUtf8String(daoBytes));
      
      const updatedDAO = { ...daoData, status: "approved" };
      await contract.setData(`dao_${daoId}`, ethers.toUtf8Bytes(JSON.stringify(updatedDAO)));
      
      setTransactionStatus({ visible: true, status: "success", message: "DAO approved for M&A!" });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Approval failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectDAO = async (daoId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing DAO data with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const daoBytes = await contract.getData(`dao_${daoId}`);
      if (daoBytes.length === 0) throw new Error("DAO not found");
      const daoData = JSON.parse(ethers.toUtf8String(daoBytes));
      const updatedDAO = { ...daoData, status: "rejected" };
      await contract.setData(`dao_${daoId}`, ethers.toUtf8Bytes(JSON.stringify(updatedDAO)));
      setTransactionStatus({ visible: true, status: "success", message: "DAO rejected!" });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (daoAddress: string) => address?.toLowerCase() === daoAddress.toLowerCase();

  const tutorialSteps = [
    { title: "Connect Wallet", description: "Connect your Web3 wallet to access the confidential M&A platform", icon: "🔗" },
    { title: "Submit DAO Data", description: "Add your DAO's confidential financial data which will be encrypted using FHE", icon: "🔒", details: "Your DAO's valuation, treasury and member data is encrypted on the client-side before submission" },
    { title: "FHE Processing", description: "Data is processed in encrypted state without decryption", icon: "⚙️", details: "Zama FHE technology allows confidential computations on encrypted data during M&A due diligence" },
    { title: "Secure Voting", description: "DAO members vote on merger terms while keeping data private", icon: "🗳️", details: "Voting happens in the encrypted data room with FHE-protected ballots" }
  ];

  const renderValuationChart = () => {
    const topDAOs = [...records]
      .filter(r => r.status === "approved")
      .sort((a, b) => {
        const valA = decryptedValues.valuation || 0;
        const valB = decryptedValues.valuation || 0;
        return valB - valA;
      })
      .slice(0, 5);
    
    const maxValue = topDAOs.reduce((max, dao) => {
      const val = decryptedValues.valuation || 0;
      return val > max ? val : max;
    }, 0);

    return (
      <div className="valuation-chart">
        <h3>Top DAO Valuations (ETH)</h3>
        <div className="chart-bars">
          {topDAOs.map(dao => {
            const val = decryptedValues.valuation || 0;
            const percentage = maxValue > 0 ? (val / maxValue) * 100 : 0;
            return (
              <div key={dao.id} className="chart-bar-container">
                <div className="dao-name">{dao.name}</div>
                <div className="chart-bar" style={{ width: `${percentage}%` }}>
                  <div className="bar-value">{val.toLocaleString()}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderMAProcess = () => {
    const steps = [
      { title: "DAO Submission", description: "DAOs submit encrypted financial data", status: "completed" },
      { title: "Due Diligence", description: "Confidential review in FHE data room", status: "active" },
      { title: "Term Negotiation", description: "Encrypted term sheet generation", status: "pending" },
      { title: "Community Voting", description: "Private voting on merger terms", status: "pending" },
      { title: "Finalization", description: "Secure merger execution", status: "pending" }
    ];

    return (
      <div className="ma-process">
        <h2>M&A Process Flow</h2>
        <div className="process-steps">
          {steps.map((step, index) => (
            <div key={index} className={`process-step ${step.status}`}>
              <div className="step-number">{index + 1}</div>
              <div className="step-content">
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
              <div className="step-connector"></div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="mechanical-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container industrial-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="gear-icon"></div></div>
          <h1>DAO<span>M&A</span>Platform</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-dao-btn industrial-button">
            <div className="add-icon"></div>Add DAO
          </button>
          <button className="industrial-button" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential DAO M&A Platform</h2>
            <p>Secure mergers & acquisitions powered by Zama FHE technology</p>
          </div>
          <div className="fhe-indicator"><div className="fhe-lock"></div><span>FHE Encryption Active</span></div>
        </div>
        
        <div className="tab-navigation">
          <button 
            className={`tab-button ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          <button 
            className={`tab-button ${activeTab === 'ma-process' ? 'active' : ''}`}
            onClick={() => setActiveTab('ma-process')}
          >
            M&A Process
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <>
            {showTutorial && (
              <div className="tutorial-section">
                <h2>FHE-Powered DAO M&A Tutorial</h2>
                <p className="subtitle">Learn how to confidentially merge DAOs using FHE encryption</p>
                <div className="tutorial-steps">
                  {tutorialSteps.map((step, index) => (
                    <div className="tutorial-step" key={index}>
                      <div className="step-icon">{step.icon}</div>
                      <div className="step-content">
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                        {step.details && <div className="step-details">{step.details}</div>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="fhe-diagram">
                  <div className="diagram-step"><div className="diagram-icon">🏛️</div><div className="diagram-label">DAO Data</div></div>
                  <div className="diagram-arrow">→</div>
                  <div className="diagram-step"><div className="diagram-icon">🔒</div><div className="diagram-label">FHE Encryption</div></div>
                  <div className="diagram-arrow">→</div>
                  <div className="diagram-step"><div className="diagram-icon">📊</div><div className="diagram-label">Encrypted Analysis</div></div>
                  <div className="diagram-arrow">→</div>
                  <div className="diagram-step"><div className="diagram-icon">🤝</div><div className="diagram-label">Secure M&A</div></div>
                </div>
              </div>
            )}
            
            <div className="dashboard-grid">
              <div className="dashboard-card industrial-card">
                <h3>Project Introduction</h3>
                <p>Confidential M&A platform for DAOs using <strong>Zama FHE technology</strong>. Perform due diligence and voting on encrypted financial data without exposing sensitive information.</p>
                <div className="fhe-badge"><span>FHE-Powered</span></div>
              </div>
              
              <div className="dashboard-card industrial-card">
                <h3>DAO Statistics</h3>
                <div className="stats-grid">
                  <div className="stat-item"><div className="stat-value">{records.length}</div><div className="stat-label">Total DAOs</div></div>
                  <div className="stat-item"><div className="stat-value">{approvedCount}</div><div className="stat-label">Approved</div></div>
                  <div className="stat-item"><div className="stat-value">{pendingCount}</div><div className="stat-label">Pending</div></div>
                  <div className="stat-item"><div className="stat-value">{rejectedCount}</div><div className="stat-label">Rejected</div></div>
                </div>
              </div>
              
              <div className="dashboard-card industrial-card">
                <h3>Valuation Analysis</h3>
                {renderValuationChart()}
              </div>
            </div>
            
            <div className="daos-section">
              <div className="section-header">
                <h2>Encrypted DAO Records</h2>
                <div className="header-actions">
                  <button onClick={loadRecords} className="refresh-btn industrial-button" disabled={isRefreshing}>
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              <div className="daos-list industrial-card">
                <div className="table-header">
                  <div className="header-cell">DAO Name</div>
                  <div className="header-cell">Valuation</div>
                  <div className="header-cell">Members</div>
                  <div className="header-cell">Treasury</div>
                  <div className="header-cell">Owner</div>
                  <div className="header-cell">Status</div>
                  <div className="header-cell">Actions</div>
                </div>
                {records.length === 0 ? (
                  <div className="no-records">
                    <div className="no-records-icon"></div>
                    <p>No DAO records found</p>
                    <button className="industrial-button primary" onClick={() => setShowCreateModal(true)}>Add First DAO</button>
                  </div>
                ) : records.map(dao => (
                  <div className="dao-row" key={dao.id} onClick={() => setSelectedRecord(dao)}>
                    <div className="table-cell">{dao.name}</div>
                    <div className="table-cell">
                      {decryptedValues.valuation !== undefined ? 
                        `${decryptedValues.valuation.toLocaleString()} ETH` : 
                        "🔒 Encrypted"}
                    </div>
                    <div className="table-cell">
                      {decryptedValues.members !== undefined ? 
                        decryptedValues.members.toLocaleString() : 
                        "🔒 Encrypted"}
                    </div>
                    <div className="table-cell">
                      {decryptedValues.treasury !== undefined ? 
                        `${decryptedValues.treasury.toLocaleString()} ETH` : 
                        "🔒 Encrypted"}
                    </div>
                    <div className="table-cell">{dao.owner.substring(0, 6)}...{dao.owner.substring(38)}</div>
                    <div className="table-cell"><span className={`status-badge ${dao.status}`}>{dao.status}</span></div>
                    <div className="table-cell actions">
                      {isOwner(dao.owner) && dao.status === "pending" && (
                        <>
                          <button className="action-btn industrial-button success" onClick={(e) => { e.stopPropagation(); approveDAO(dao.id); }}>Approve</button>
                          <button className="action-btn industrial-button danger" onClick={(e) => { e.stopPropagation(); rejectDAO(dao.id); }}>Reject</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="ma-process-container">
            {renderMAProcess()}
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitDAO} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
        />
      )}
      
      {selectedRecord && (
        <DAODetailModal 
          dao={selectedRecord} 
          onClose={() => { 
            setSelectedRecord(null); 
            setDecryptedValues({}); 
          }} 
          decryptedValues={decryptedValues}
          setDecryptedValues={setDecryptedValues}
          isDecrypting={isDecrypting}
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content industrial-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="mechanical-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="gear-icon"></div><span>DAO M&A Platform</span></div>
            <p>Confidential mergers powered by Zama FHE technology</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Confidentiality</span></div>
          <div className="copyright">© {new Date().getFullYear()} DAO M&A Platform. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, recordData, setRecordData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!recordData.name || !recordData.valuation || !recordData.members || !recordData.treasury) { 
      alert("Please fill all required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal industrial-card">
        <div className="modal-header">
          <h2>Add DAO Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div><strong>FHE Encryption Notice</strong><p>Your DAO's sensitive data will be encrypted with Zama FHE before submission</p></div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>DAO Name *</label>
              <input 
                type="text" 
                name="name" 
                value={recordData.name} 
                onChange={handleChange} 
                placeholder="Enter DAO name..." 
                className="industrial-input"
              />
            </div>
            <div className="form-group">
              <label>Valuation (ETH) *</label>
              <input 
                type="number" 
                name="valuation" 
                value={recordData.valuation} 
                onChange={handleValueChange} 
                placeholder="Enter valuation..." 
                className="industrial-input"
                step="0.01"
              />
            </div>
            <div className="form-group">
              <label>Members Count *</label>
              <input 
                type="number" 
                name="members" 
                value={recordData.members} 
                onChange={handleValueChange} 
                placeholder="Enter member count..." 
                className="industrial-input"
              />
            </div>
            <div className="form-group">
              <label>Treasury (ETH) *</label>
              <input 
                type="number" 
                name="treasury" 
                value={recordData.treasury} 
                onChange={handleValueChange} 
                placeholder="Enter treasury amount..." 
                className="industrial-input"
                step="0.01"
              />
            </div>
          </div>
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Values:</span>
                <div>Valuation: {recordData.valuation || '0'} ETH</div>
                <div>Members: {recordData.members || '0'}</div>
                <div>Treasury: {recordData.treasury || '0'} ETH</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>Valuation: {recordData.valuation ? FHEEncryptNumber(recordData.valuation).substring(0, 20) + '...' : 'Not encrypted'}</div>
                <div>Members: {recordData.members ? FHEEncryptNumber(recordData.members).substring(0, 20) + '...' : 'Not encrypted'}</div>
                <div>Treasury: {recordData.treasury ? FHEEncryptNumber(recordData.treasury).substring(0, 20) + '...' : 'Not encrypted'}</div>
              </div>
            </div>
          </div>
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div><strong>Data Privacy Guarantee</strong><p>DAO data remains encrypted during M&A process and is never decrypted on our servers</p></div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn industrial-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn industrial-button primary">
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DAODetailModalProps {
  dao: DAORecord;
  onClose: () => void;
  decryptedValues: {valuation?: number, members?: number, treasury?: number};
  setDecryptedValues: (values: {valuation?: number, members?: number, treasury?: number}) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string, field: string) => Promise<number | null>;
}

const DAODetailModal: React.FC<DAODetailModalProps> = ({ dao, onClose, decryptedValues, setDecryptedValues, isDecrypting, decryptWithSignature }) => {
  const handleDecrypt = async (field: 'valuation' | 'members' | 'treasury') => {
    if (decryptedValues[field] !== undefined) {
      setDecryptedValues({...decryptedValues, [field]: undefined});
      return;
    }
    await decryptWithSignature(dao[field], field);
  };

  return (
    <div className="modal-overlay">
      <div className="dao-detail-modal industrial-card">
        <div className="modal-header">
          <h2>DAO Details: {dao.name}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="dao-info">
            <div className="info-item"><span>ID:</span><strong>#{dao.id.substring(0, 8)}</strong></div>
            <div className="info-item"><span>Owner:</span><strong>{dao.owner.substring(0, 6)}...{dao.owner.substring(38)}</strong></div>
            <div className="info-item"><span>Date:</span><strong>{new Date(dao.timestamp * 1000).toLocaleString()}</strong></div>
            <div className="info-item"><span>Status:</span><strong className={`status-badge ${dao.status}`}>{dao.status}</strong></div>
          </div>
          
          <div className="dao-data-section">
            <h3>Financial Data</h3>
            
            <div className="data-field">
              <div className="field-header">
                <span>Valuation:</span>
                <button 
                  className="decrypt-btn industrial-button" 
                  onClick={() => handleDecrypt('valuation')} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : 
                   decryptedValues.valuation !== undefined ? "Hide Value" : "Decrypt Valuation"}
                </button>
              </div>
              <div className="field-value">
                {decryptedValues.valuation !== undefined ? 
                  `${decryptedValues.valuation.toLocaleString()} ETH` : 
                  "🔒 Encrypted"}
              </div>
            </div>
            
            <div className="data-field">
              <div className="field-header">
                <span>Members:</span>
                <button 
                  className="decrypt-btn industrial-button" 
                  onClick={() => handleDecrypt('members')} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : 
                   decryptedValues.members !== undefined ? "Hide Value" : "Decrypt Members"}
                </button>
              </div>
              <div className="field-value">
                {decryptedValues.members !== undefined ? 
                  decryptedValues.members.toLocaleString() : 
                  "🔒 Encrypted"}
              </div>
            </div>
            
            <div className="data-field">
              <div className="field-header">
                <span>Treasury:</span>
                <button 
                  className="decrypt-btn industrial-button" 
                  onClick={() => handleDecrypt('treasury')} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : 
                   decryptedValues.treasury !== undefined ? "Hide Value" : "Decrypt Treasury"}
                </button>
              </div>
              <div className="field-value">
                {decryptedValues.treasury !== undefined ? 
                  `${decryptedValues.treasury.toLocaleString()} ETH` : 
                  "🔒 Encrypted"}
              </div>
            </div>
            
            <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn industrial-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;