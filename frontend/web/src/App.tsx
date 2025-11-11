import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface FanCard {
  id: string;
  name: string;
  encryptedValue: any;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<FanCard[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingCard, setCreatingCard] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newCardData, setNewCardData] = useState({ name: "", tokenCount: "", description: "" });
  const [selectedCard, setSelectedCard] = useState<FanCard | null>(null);
  const [decryptedCount, setDecryptedCount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("cards");
  const [history, setHistory] = useState<any[]>([]);
  const [faqVisible, setFaqVisible] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || fhevmInitializing || isInitialized) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const cardsList: FanCard[] = [];
      
      for (const id of businessIds) {
        try {
          const data = await contract.getBusinessData(id);
          cardsList.push({
            id,
            name: data.name,
            encryptedValue: null,
            publicValue1: Number(data.publicValue1) || 0,
            publicValue2: Number(data.publicValue2) || 0,
            description: data.description,
            creator: data.creator,
            timestamp: Number(data.timestamp),
            isVerified: data.isVerified,
            decryptedValue: Number(data.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading card data:', e);
        }
      }
      
      setCards(cardsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createCard = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingCard(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating card with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const tokenCount = parseInt(newCardData.tokenCount) || 0;
      const cardId = `fanpass-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, tokenCount);
      
      const tx = await contract.createBusinessData(
        cardId,
        newCardData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newCardData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Confirming transaction..." });
      await tx.wait();
      
      setHistory([...history, {
        type: "create",
        id: cardId,
        name: newCardData.name,
        timestamp: Date.now()
      }]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Card created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewCardData({ name: "", tokenCount: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingCard(false); 
    }
  };

  const decryptData = async (cardId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const cardData = await contractRead.getBusinessData(cardId);
      if (cardData.isVerified) {
        const storedValue = Number(cardData.decryptedValue) || 0;
        setDecryptedCount(storedValue);
        
        setHistory([...history, {
          type: "verify",
          id: cardId,
          name: cardData.name,
          timestamp: Date.now()
        }]);
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(cardId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(cardId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      const numericValue = Number(clearValue);
      setDecryptedCount(numericValue);
      
      await loadData();
      
      setHistory([...history, {
        type: "verify",
        id: cardId,
        name: selectedCard?.name || "",
        timestamp: Date.now(),
        value: numericValue
      }]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return numericValue;
      
    } catch (e: any) { 
      if (e.message?.includes("already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      if (result) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Contract is available!" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Availability check failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FanPass FHE 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Access</h2>
            <p>Private fan membership powered by FHE encryption</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Create encrypted fan membership cards</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Access exclusive content privately</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption...</p>
        <p>Status: {fhevmInitializing ? "Initializing" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading FanPass system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FanPass FHE 🔐</h1>
          <p>Private Fan Membership</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Card
          </button>
          <button 
            onClick={callIsAvailable}
            className="test-btn"
          >
            Test Contract
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="tabs">
          <button 
            className={activeTab === "cards" ? "active" : ""}
            onClick={() => setActiveTab("cards")}
          >
            My Cards
          </button>
          <button 
            className={activeTab === "history" ? "active" : ""}
            onClick={() => setActiveTab("history")}
          >
            History
          </button>
          <button 
            className={activeTab === "about" ? "active" : ""}
            onClick={() => setActiveTab("about")}
          >
            About
          </button>
          <button 
            className={activeTab === "faq" ? "active" : ""}
            onClick={() => {
              setActiveTab("faq");
              setFaqVisible(true);
            }}
          >
            FAQ
          </button>
        </div>
        
        {activeTab === "cards" && (
          <div className="cards-section">
            <div className="section-header">
              <h2>My FanPass Cards</h2>
              <div className="header-actions">
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="cards-grid">
              {cards.length === 0 ? (
                <div className="no-cards">
                  <p>No fan cards found</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Card
                  </button>
                </div>
              ) : cards.map((card, index) => (
                <div 
                  className={`card-item ${selectedCard?.id === card.id ? "selected" : ""} ${card.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => setSelectedCard(card)}
                >
                  <div className="card-badge">VIP</div>
                  <div className="card-title">{card.name}</div>
                  <div className="card-meta">
                    <span>Created: {new Date(card.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="card-status">
                    {card.isVerified ? "✅ Verified" : "🔓 Verify Tokens"}
                  </div>
                  <div className="card-creator">By: {card.creator.substring(0, 6)}...{card.creator.substring(38)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "history" && (
          <div className="history-section">
            <h2>Operation History</h2>
            <div className="history-list">
              {history.length === 0 ? (
                <div className="no-history">
                  <p>No operations recorded</p>
                </div>
              ) : history.map((record, index) => (
                <div className="history-item" key={index}>
                  <div className="history-type">{record.type === "create" ? "Created" : "Verified"}</div>
                  <div className="history-details">
                    <div className="history-name">{record.name}</div>
                    <div className="history-id">ID: {record.id}</div>
                    {record.value && <div className="history-value">Tokens: {record.value}</div>}
                  </div>
                  <div className="history-time">
                    {new Date(record.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "about" && (
          <div className="about-section">
            <h2>About FanPass FHE</h2>
            <div className="about-content">
              <div className="about-card">
                <h3>Private Fan Membership</h3>
                <p>FanPass uses fully homomorphic encryption (FHE) to protect your fan token holdings while still proving you meet access requirements.</p>
              </div>
              
              <div className="about-card">
                <h3>How It Works</h3>
                <ol>
                  <li>Encrypt your fan token count using Zama FHE</li>
                  <li>Store encrypted data on-chain</li>
                  <li>Verify access without revealing exact holdings</li>
                  <li>Access exclusive content privately</li>
                </ol>
              </div>
              
              <div className="about-card">
                <h3>Benefits</h3>
                <ul>
                  <li>Complete privacy for your holdings</li>
                  <li>Secure access to VIP content</li>
                  <li>Trustless verification system</li>
                  <li>No central authority</li>
                </ul>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "faq" && faqVisible && (
          <div className="faq-section">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-content">
              <div className="faq-item">
                <h3>What is FHE?</h3>
                <p>Fully Homomorphic Encryption allows computations on encrypted data without decrypting it first.</p>
              </div>
              
              <div className="faq-item">
                <h3>How are my tokens protected?</h3>
                <p>Your token count is encrypted before being stored on-chain. Only you can decrypt it.</p>
              </div>
              
              <div className="faq-item">
                <h3>What can I access?</h3>
                <p>Depending on your token holdings, you may access exclusive content, events, and communities.</p>
              </div>
              
              <div className="faq-item">
                <h3>Is this secure?</h3>
                <p>Yes, FHE provides mathematical guarantees of privacy while allowing verification.</p>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreateCard 
          onSubmit={createCard} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingCard} 
          cardData={newCardData} 
          setCardData={setNewCardData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedCard && (
        <CardDetailModal 
          card={selectedCard} 
          onClose={() => { 
            setSelectedCard(null); 
            setDecryptedCount(null); 
          }} 
          decryptedCount={decryptedCount} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedCard.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <p>FanPass FHE - Private Fan Membership System</p>
        <p>Powered by Zama FHE Technology</p>
      </footer>
    </div>
  );
};

const ModalCreateCard: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  cardData: any;
  setCardData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, cardData, setCardData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'tokenCount') {
      const intValue = value.replace(/[^\d]/g, '');
      setCardData({ ...cardData, [name]: intValue });
    } else {
      setCardData({ ...cardData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-card-modal">
        <div className="modal-header">
          <h2>New FanPass Card</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Token count will be encrypted with Zama FHE</p>
          </div>
          
          <div className="form-group">
            <label>Card Name *</label>
            <input 
              type="text" 
              name="name" 
              value={cardData.name} 
              onChange={handleChange} 
              placeholder="Enter card name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Token Count *</label>
            <input 
              type="number" 
              name="tokenCount" 
              value={cardData.tokenCount} 
              onChange={handleChange} 
              placeholder="Enter token count..." 
              min="0"
            />
            <div className="data-type-label">FHE Encrypted</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={cardData.description} 
              onChange={handleChange} 
              placeholder="Enter description..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !cardData.name || !cardData.tokenCount} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Card"}
          </button>
        </div>
      </div>
    </div>
  );
};

const CardDetailModal: React.FC<{
  card: FanCard;
  onClose: () => void;
  decryptedCount: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ card, onClose, decryptedCount, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedCount !== null) return;
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="card-detail-modal">
        <div className="modal-header">
          <h2>FanPass Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="card-info">
            <div className="info-item">
              <span>Card Name:</span>
              <strong>{card.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{card.creator.substring(0, 6)}...{card.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(card.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Token Data</h3>
            
            <div className="data-row">
              <div className="data-label">Token Count:</div>
              <div className="data-value">
                {card.isVerified ? 
                  `${card.decryptedValue} (Verified)` : 
                  decryptedCount !== null ? 
                  `${decryptedCount} (Decrypted)` : 
                  "🔒 Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(card.isVerified || decryptedCount !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || card.isVerified}
              >
                {isDecrypting ? (
                  "🔓 Decrypting..."
                ) : card.isVerified ? (
                  "✅ Verified"
                ) : decryptedCount !== null ? (
                  "🔓 Decrypted"
                ) : (
                  "🔓 Decrypt Tokens"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Privacy</strong>
                <p>Your token count is encrypted on-chain. Only you can decrypt and verify it.</p>
              </div>
            </div>
          </div>
          
          <div className="benefits-section">
            <h3>Exclusive Benefits</h3>
            <ul>
              <li>Access to private fan community</li>
              <li>Exclusive content and updates</li>
              <li>Special events access</li>
              <li>VIP merchandise</li>
            </ul>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


