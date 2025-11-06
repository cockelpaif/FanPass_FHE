pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FanPassFHE is ZamaEthereumConfig {
    struct Membership {
        address owner;
        euint32 encryptedBalance;
        uint32 decryptedBalance;
        bool isVerified;
        uint256 timestamp;
        string tokenURI;
    }

    mapping(uint256 => Membership) private memberships;
    mapping(address => uint256[]) private ownerMemberships;
    uint256[] private membershipIds;

    event MembershipCreated(uint256 indexed tokenId, address indexed owner);
    event BalanceVerified(uint256 indexed tokenId, uint32 balance);

    modifier onlyOwner(uint256 tokenId) {
        require(memberships[tokenId].owner == msg.sender, "Not owner");
        _;
    }

    constructor() ZamaEthereumConfig() {}

    function createMembership(
        externalEuint32 encryptedBalance,
        bytes calldata inputProof,
        string calldata tokenURI
    ) external returns (uint256) {
        uint256 tokenId = membershipIds.length;

        require(!FHE.isInitialized(FHE.fromExternal(encryptedBalance, inputProof)), "Invalid encryption");

        memberships[tokenId] = Membership({
            owner: msg.sender,
            encryptedBalance: FHE.fromExternal(encryptedBalance, inputProof),
            decryptedBalance: 0,
            isVerified: false,
            timestamp: block.timestamp,
            tokenURI: tokenURI
        });

        FHE.allowThis(memberships[tokenId].encryptedBalance);
        FHE.makePubliclyDecryptable(memberships[tokenId].encryptedBalance);

        ownerMemberships[msg.sender].push(tokenId);
        membershipIds.push(tokenId);

        emit MembershipCreated(tokenId, msg.sender);
        return tokenId;
    }

    function verifyBalance(
        uint256 tokenId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external onlyOwner(tokenId) {
        require(!memberships[tokenId].isVerified, "Already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(memberships[tokenId].encryptedBalance);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        memberships[tokenId].decryptedBalance = decodedValue;
        memberships[tokenId].isVerified = true;

        emit BalanceVerified(tokenId, decodedValue);
    }

    function getMembership(uint256 tokenId) external view returns (
        address owner,
        uint32 decryptedBalance,
        bool isVerified,
        uint256 timestamp,
        string memory tokenURI
    ) {
        Membership storage m = memberships[tokenId];
        return (m.owner, m.decryptedBalance, m.isVerified, m.timestamp, m.tokenURI);
    }

    function getEncryptedBalance(uint256 tokenId) external view returns (euint32) {
        return memberships[tokenId].encryptedBalance;
    }

    function getOwnerMemberships(address owner) external view returns (uint256[] memory) {
        return ownerMemberships[owner];
    }

    function getMembershipIds() external view returns (uint256[] memory) {
        return membershipIds;
    }

    function checkAccess(uint256 tokenId, uint32 threshold) external view returns (bool) {
        require(memberships[tokenId].isVerified, "Not verified");
        return memberships[tokenId].decryptedBalance >= threshold;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


