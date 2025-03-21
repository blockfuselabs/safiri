const { Account, ec, stark, RpcProvider, hash, CallData, CairoOption, CairoOptionVariant, CairoCustomEnum } = require('starknet');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Configuration
const NODE_URL = process.env.STARKNET_NODE_URL || 'https://free-rpc.nethermind.io/sepolia-juno/v0_7';
const ARGENT_ACCOUNT_CLASS_HASH = '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f';

const args = process.argv.slice(2);
const addressToFind = args[0];

if (!addressToFind) {
  console.error('Please provide an address: node deploy-account.js <address>');
  process.exit(1);
}

// Debug logging
console.log('Looking for wallet with address:', addressToFind);
console.log('Current directory:', process.cwd());
console.log('Parent directory:', path.join(__dirname, '..'));

async function findWalletInfoByAddress(address) {
  try {
    // First look in current directory
    let walletFiles = fs.readdirSync('./').filter(file => 
      file.startsWith('wallet-info') && file.endsWith('.json')
    );
    
    // If no files found, look in parent directory
    if (walletFiles.length === 0) {
      const parentDir = path.join(__dirname, '..');
      console.log('Looking in parent directory:', parentDir);
      
      try {
        walletFiles = fs.readdirSync(parentDir).filter(file => 
          file.startsWith('wallet-info') && file.endsWith('.json')
        );
        console.log('Found wallet files in parent directory:', walletFiles);
        
        // Check each file in parent directory
        for (const file of walletFiles) {
          try {
            const filePath = path.join(parentDir, file);
            const walletData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log(`Checking file ${file}, address: ${walletData.address}`);
            if (walletData.address === address) {
              return { walletInfo: walletData, filePath };
            }
          } catch (err) {
            console.error(`Error reading ${file}:`, err.message);
          }
        }
      } catch (err) {
        console.error('Error reading parent directory:', err.message);
      }
    } else {
      console.log('Found wallet files in current directory:', walletFiles);
      
      // Check each file in current directory
      for (const file of walletFiles) {
        try {
          const walletData = JSON.parse(fs.readFileSync(`./${file}`, 'utf8'));
          console.log(`Checking file ${file}, address: ${walletData.address}`);
          if (walletData.address === address) {
            return { walletInfo: walletData, filePath: `./${file}` };
          }
        } catch (err) {
          console.error(`Error reading ${file}:`, err.message);
        }
      }
    }
    
    // Check specific wallet-info.json in current and parent directories
    if (fs.existsSync('./wallet-info.json')) {
      const walletInfo = JSON.parse(fs.readFileSync('./wallet-info.json', 'utf8'));
      if (walletInfo.address === address) {
        return { walletInfo, filePath: './wallet-info.json' };
      }
    }
    
    const parentWalletInfo = path.join(__dirname, '..', 'wallet-info.json');
    if (fs.existsSync(parentWalletInfo)) {
      const walletInfo = JSON.parse(fs.readFileSync(parentWalletInfo, 'utf8'));
      if (walletInfo.address === address) {
        return { walletInfo, filePath: parentWalletInfo };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error finding wallet info:', error);
    return null;
  }
}

async function deployArgentAccount(privateKey, preCalculatedAddress) {
  try {
    console.log('\nDeploying Argent wallet...');
    
    const provider = new RpcProvider({ nodeUrl: NODE_URL });
    
    const starkKeyPub = ec.starkCurve.getStarkKey(privateKey);
    
    // Using the simpler deployment logic from the second script
    const axSigner = new CairoCustomEnum({ Starknet: { pubkey: starkKeyPub } });
    const axGuardian = new CairoOption(CairoOptionVariant.None);
    const argentConstructorCallData = CallData.compile({
      owner: axSigner,
      guardian: axGuardian
    });
    
    // Create account instance
    const account = new Account(provider, preCalculatedAddress, privateKey);
    
    console.log('Deploying account...');
    const deployAccountPayload = {
      classHash: ARGENT_ACCOUNT_CLASS_HASH,
      constructorCalldata: argentConstructorCallData,
      contractAddress: preCalculatedAddress,
      addressSalt: starkKeyPub
    };
    
    const { transaction_hash, contract_address } = await account.deployAccount(deployAccountPayload);
    
    console.log('Deployment transaction hash:', transaction_hash);
    console.log('Waiting for transaction confirmation...');
    
    await provider.waitForTransaction(transaction_hash);
    
    console.log('\n✅ Argent account deployed successfully!');
    console.log('Account address:', contract_address);
    
    return { transaction_hash, contract_address };
  } catch (error) {
    console.error('Error deploying wallet:', error);
    throw error;
  }
}

function createSampleWalletFile(address) {
  console.log(`Creating sample wallet info file for address: ${address}`);
  
  // Get the private key from user input or environment
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) {
    console.error('Please set WALLET_PRIVATE_KEY in .env file for test creation');
    return false;
  }
  
  const starkKeyPub = ec.starkCurve.getStarkKey(privateKey);
  
  const walletInfo = {
    type: 'Argent',
    privateKey,
    publicKey: starkKeyPub,
    address: address,
    deployed: false,
    createdAt: new Date().toISOString()
  };
  
  fs.writeFileSync('./wallet-info.json', JSON.stringify(walletInfo, null, 2));
  console.log('Sample wallet information saved to wallet-info.json');
  return true;
}

async function main() {
  try {
    if (args[1] === '--create-sample') {
      const created = createSampleWalletFile(addressToFind);
      if (!created) {
        process.exit(1);
      }
    }
    
    const walletData = await findWalletInfoByAddress(addressToFind);
    
    if (!walletData) {
      console.error(`No wallet information found for address: ${addressToFind}`);
      console.error('Make sure the wallet-info.json file exists or wallet-info-<phonenumber>.json file exists');
      console.error('You can create a sample file using: node deploy-account.js <address> --create-sample');
      process.exit(1);
    }
    
    const { walletInfo, filePath } = walletData;
    
    if (walletInfo.deployed) {
      console.log('Wallet is already deployed at address:', walletInfo.address);
      process.exit(0);
    }
    
    // Removed balance check to allow deployment regardless of balance
    console.log('Skipping balance check, proceeding with deployment...');
    
    // Call deploy function without balance verification
    const result = await deployArgentAccount(walletInfo.privateKey, walletInfo.address);
    
    // Update wallet info after successful deployment
    walletInfo.deployed = true;
    walletInfo.deployedAt = new Date().toISOString();
    walletInfo.deployTxHash = result.transaction_hash;
    fs.writeFileSync(filePath, JSON.stringify(walletInfo, null, 2));
    console.log(`Wallet information updated in ${filePath}`);
    
    console.log('\nDeployment completed successfully!');
  } catch (error) {
    console.error('Error in deployment process:', error);
    console.error('Error details:', error.message);
    if (error.response) {
      console.error('API response:', error.response);
    }
    process.exit(1);
  }
}

main();