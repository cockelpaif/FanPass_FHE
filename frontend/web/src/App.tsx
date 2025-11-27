import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface FanCard {
  id: string;
  name: string;
  encryptedValue: string;
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
  const [fanCards, setFanCards] = useState<FanCard[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingCard, setCreatingCard] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newCardData, setNewCardData] = useState({ name: "", value: "", description: "" });
  const [selectedCard, setSelectedCard] = useState<FanCard | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (!isConnected) return;
      if (!isInitialized) {
        try {
          await initialize();
        } catch (error) {
          console.error('FHEVM init failed:', error);
        }
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        const contract = await getContractReadOnly();
        if (!contract) return;
        setContractAddress(await contract.getAddress());
        const businessIds = await contract.getAllBusinessIds();
        const cards: FanCard[] = [];
        for (const id of businessIds) {
          const data = await contract.getBusinessData(id);
          cards.push({
            id,
            name: data.name,
            encryptedValue: id,
            publicValue1: Number(data.publicValue1),
            publicValue2: Number(data.publicValue2),
            description: data.description,
            creator: data.creator,
            timestamp: Number(data.timestamp),
            isVerified: data.isVerified,
            decryptedValue: Number(data.decryptedValue)
          });
        }
        setFanCards(cards);
      } catch (error) {
        console.error('Load data error:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isConnected]);

  const createFanCard = async () => {
    if (!isConnected || !address) {
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return;
    }
    setCreatingCard(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating fan card..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");
      const value = parseInt(newCardData.value) || 0;
      const encryptedResult = await encrypt(contractAddress, address, value);
      const id = `fan-${Date.now()}`;
      const tx = await contract.createBusinessData(
        id,
        newCardData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newCardData.description
      );
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      setHistory([...history, `Created card: ${newCardData.name}`]);
      setTransactionStatus({ visible: true, status: "success", message: "Card created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCardData({ name: "", value: "", description: "" });
      }, 2000);
      window.location.reload();
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: e.message || "Error creating card" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setCreatingCard(false);
    }
  };

  const decryptValue = async (id: string) => {
    if (!isConnected || !address) {
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    }
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      const contractWrite = await getContractWithSigner();
      if (!contractRead || !contractWrite) return null;
      const data = await contractRead.getBusinessData(id);
      if (data.isVerified) {
        setDecryptedData(Number(data.decryptedValue));
        setHistory([...history, `Viewed decrypted value for: ${data.name}`]);
        return Number(data.decryptedValue);
      }
      const encryptedValue = await contractRead.getEncryptedValue(id);
      const result = await verifyDecryption(
        [encryptedValue],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(id, abiEncodedClearValues, decryptionProof)
      );
      const clearValue = result.decryptionResult.clearValues[encryptedValue];
      setDecryptedData(Number(clearValue));
      setHistory([...history, `Decrypted value for: ${data.name}`]);
      return Number(clearValue);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: e.message || "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    } finally {
      setIsDecrypting(false);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "Service is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      console.error('Check availability error:', e);
    }
  };

  const filteredCards = fanCards.filter(card => 
    card.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    card.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FanPass FHE 🔐</h1>
            <p>Private Fan Membership</p>
          </div>
          <div className="wallet-connect">
            <ConnectButton />
          </div>
        </header>
        <div className="connection-prompt">
          <div className="prompt-content">
            <h2>Connect Your Wallet</h2>
            <p>Join the private fan community with FHE encrypted membership</p>
            <div className="fhe-badge">🔐 FHE Encrypted</div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Loading Fan Cards...</p>
      </div>
    );
  }

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
            className="create-button"
          >
            + New Fan Card
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-content">
        <div className="stats-section">
          <div className="stat-card">
            <h3>Total Cards</h3>
            <p>{fanCards.length}</p>
          </div>
          <div className="stat-card">
            <h3>Verified</h3>
            <p>{fanCards.filter(c => c.isVerified).length}</p>
          </div>
          <div className="stat-card">
            <h3>Your Cards</h3>
            <p>{fanCards.filter(c => c.creator === address).length}</p>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search fan cards..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={checkAvailability} className="check-button">
            Check Service
          </button>
        </div>

        <div className="cards-section">
          <h2>Fan Cards</h2>
          {filteredCards.length === 0 ? (
            <div className="empty-state">
              <p>No fan cards found</p>
              <button 
                onClick={() => setShowCreateModal(true)}
                className="create-button"
              >
                Create First Card
              </button>
            </div>
          ) : (
            <div className="cards-grid">
              {filteredCards.map((card) => (
                <div 
                  key={card.id} 
                  className={`fan-card ${selectedCard?.id === card.id ? 'selected' : ''}`}
                  onClick={() => setSelectedCard(card)}
                >
                  <div className="card-header">
                    <h3>{card.name}</h3>
                    <div className={`card-badge ${card.isVerified ? 'verified' : 'unverified'}`}>
                      {card.isVerified ? 'Verified' : 'Unverified'}
                    </div>
                  </div>
                  <p className="card-desc">{card.description}</p>
                  <div className="card-footer">
                    <span>{new Date(card.timestamp * 1000).toLocaleDateString()}</span>
                    <span>{card.creator.substring(0, 6)}...{card.creator.substring(38)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="history-section">
          <h3>Your Activity</h3>
          <div className="history-list">
            {history.length === 0 ? (
              <p>No activity yet</p>
            ) : (
              history.map((item, index) => (
                <div key={index} className="history-item">
                  <p>{item}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="featured-section">
          <h3>Featured Content</h3>
          <div className="featured-content">
            <div className="featured-item">
              <h4>FHE Explained</h4>
              <p>Learn how your fan data stays private</p>
            </div>
            <div className="featured-item">
              <h4>Exclusive Perks</h4>
              <p>Unlock special benefits with your membership</p>
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create Fan Card</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-button">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Card Name</label>
                <input
                  type="text"
                  value={newCardData.name}
                  onChange={(e) => setNewCardData({...newCardData, name: e.target.value})}
                  placeholder="Enter card name"
                />
              </div>
              <div className="form-group">
                <label>Fan Score (FHE Encrypted)</label>
                <input
                  type="number"
                  value={newCardData.value}
                  onChange={(e) => setNewCardData({...newCardData, value: e.target.value})}
                  placeholder="Enter score (number only)"
                />
                <div className="fhe-tag">🔐 Encrypted</div>
              </div>
              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={newCardData.description}
                  onChange={(e) => setNewCardData({...newCardData, description: e.target.value})}
                  placeholder="Enter description"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-button">
                Cancel
              </button>
              <button
                onClick={createFanCard}
                disabled={creatingCard || isEncrypting || !newCardData.name || !newCardData.value}
                className="submit-button"
              >
                {creatingCard || isEncrypting ? "Creating..." : "Create Card"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedCard && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>{selectedCard.name}</h2>
              <button onClick={() => {
                setSelectedCard(null);
                setDecryptedData(null);
              }} className="close-button">
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="card-description">{selectedCard.description}</p>
              <div className="card-meta">
                <div>
                  <span>Creator:</span>
                  <p>{selectedCard.creator.substring(0, 6)}...{selectedCard.creator.substring(38)}</p>
                </div>
                <div>
                  <span>Created:</span>
                  <p>{new Date(selectedCard.timestamp * 1000).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="card-data">
                <div className="data-item">
                  <span>Fan Score:</span>
                  {selectedCard.isVerified ? (
                    <p>{selectedCard.decryptedValue} (Verified)</p>
                  ) : decryptedData !== null ? (
                    <p>{decryptedData} (Decrypted)</p>
                  ) : (
                    <p>🔒 Encrypted</p>
                  )}
                </div>
                <button
                  onClick={() => decryptValue(selectedCard.id)}
                  disabled={isDecrypting}
                  className={`decrypt-button ${selectedCard.isVerified ? 'verified' : ''}`}
                >
                  {isDecrypting ? "Decrypting..." : selectedCard.isVerified ? "Verified" : decryptedData ? "Re-decrypt" : "Decrypt"}
                </button>
              </div>
              <div className="fhe-info">
                <div className="fhe-icon">🔐</div>
                <p>This value is encrypted using FHE. Decryption happens client-side and is verified on-chain.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <div className="icon">✓</div>}
            {transactionStatus.status === "error" && <div className="icon">✗</div>}
            <p>{transactionStatus.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;