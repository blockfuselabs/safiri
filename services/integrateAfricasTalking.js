require("dotenv").config();
const africaStalkingData = require("africastalking");
const { User } = require('../models');
const { 
    Provider, 
    Account, 
    Contract, 
    ec, 
    stark, 
    hash, 
    constants,
    RpcProvider,
    CallData,
    CairoOption,
    CairoOptionVariant,
    CairoCustomEnum
} = require('starknet');
const fs = require('fs');

const africaStalking = africaStalkingData({
    apiKey: process.env.AFRICA_STALKING_API_KEY || "",
    username: process.env.AFRICA_STALKING_USERNAME || 'sandbox',
});

// Configuration
const NODE_URL = process.env.STARKNET_NODE_URL || 'https://free-rpc.nethermind.io/sepolia-juno/v0_7';
const TRANSACTION_VERSION = '0x3';

// Argent X account class hash
const ARGENT_X_ACCOUNT_CLASS_HASH = '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f';

const adminPrivateKey = process.env.ADMIN_PRIVATE_KEY;
const adminAccountAddress = process.env.ADMIN_ACCOUNT_ADDRESS;
const INITIAL_FUNDING_AMOUNT = process.env.FUNDING_AMOUNT || '2000000000000000';

const provider = new RpcProvider({ nodeUrl: NODE_URL });

let adminAccount;
if(adminPrivateKey && adminAccountAddress) {
    adminAccount = new Account(provider, adminAccountAddress, adminPrivateKey);
}


const STRK_CONTRACT = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

async function checkBalance(provider, address) {
    try {
        try {
            const balance = await provider.getBalance(address);
            return BigInt(balance.balance);
        } catch (e) {
            console.log('Standard getBalance failed, trying alternative method...');
            
           
            const response = await provider.callContract({
                contractAddress: STRK_CONTRACT,
                entrypoint: 'balanceOf',
                calldata: [address]
            });
            
            if (response && response.result && response.result.length > 0) {
                return BigInt(response.result[0]);
            }
            
            throw new Error('Could not retrieve balance through any method');
        }
    } catch (error) {
        console.warn('Could not check balance:', error.message);
        return 0n;
    }
}

async function createAndDeployAccount(fullName, phoneNumber, passcode) {
    try {
        console.log('=== STEP 1: Creating wallet ===');
        
        // Generate key pair
        const privateKey = stark.randomAddress();
        const starkKeyPub = ec.starkCurve.getStarkKey(privateKey);
        
        console.log('--- Keys Generated ---');
        console.log('Private Key:', privateKey);
        console.log('Public Key:', starkKeyPub);
        
      
        const axSigner = new CairoCustomEnum({ Starknet: { pubkey: starkKeyPub } });
        const axGuardian = new CairoOption(CairoOptionVariant.None);
        const constructorCallData = CallData.compile({
            owner: axSigner,
            guardian: axGuardian,
        });
        
        
        const contractAddress = hash.calculateContractAddressFromHash(
            starkKeyPub,
            ARGENT_X_ACCOUNT_CLASS_HASH,
            constructorCallData,
            0
        );
        
        console.log('--- Account Information ---');
        console.log('Precalculated Address:', contractAddress);
        
      
        const user = await User.create({
            fullName,
            phoneNumber,
            walletAddress: contractAddress,
            privateKey,
            pin: passcode,
            status: false
        });
        
        console.log('User record created in database');
        
       
        const walletInfo = {
            privateKey,
            publicKey: starkKeyPub,
            address: contractAddress,
            deployed: false,
            userPhone: phoneNumber,
            createdAt: new Date().toISOString()
        };
        
        const tempFilePath = `./wallet-info-${phoneNumber.replace(/[^0-9]/g, '')}.json`;
        fs.writeFileSync(tempFilePath, JSON.stringify(walletInfo, null, 2));
        console.log(`Wallet information saved to ${tempFilePath}`);
        
        // === STEP 2: Fund and deploy the account ===
        console.log('\n=== STEP 2: Deploying wallet ===');
        
       
        if (adminAccount) {
            
            const adminBalance = await checkBalance(provider, adminAccountAddress);
            console.log(`Admin account balance: ${adminBalance} wei (${Number(adminBalance) / 1e18} STRK)`);
            
            if (adminBalance < BigInt(INITIAL_FUNDING_AMOUNT)) {
                console.error('Admin account has insufficient funds for initial funding');
                return {
                    success: false,
                    message: "Admin account has insufficient funds",
                    address: contractAddress
                };
            }
            
            // Fund the new account
            console.log(`Funding account ${contractAddress} with ${Number(INITIAL_FUNDING_AMOUNT) / 1e18} STRK`);
            try {
                const transferCall = {
                    contractAddress: STRK_CONTRACT,
                    entrypoint: 'transfer',
                    calldata: [contractAddress, INITIAL_FUNDING_AMOUNT, 0]
                };
                
                const { transaction_hash: fundingTxHash } = await adminAccount.execute(transferCall, undefined, {
                    maxFee: '100000000000000',
                    version: TRANSACTION_VERSION
                });
                
                console.log("Funding transaction hash:", fundingTxHash);
                await provider.waitForTransaction(fundingTxHash);
                
              
                console.log('Checking new account balance...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                const newBalance = await checkBalance(provider, contractAddress);
                console.log(`New account balance: ${newBalance} wei (${Number(newBalance) / 1e18} STRK)`);
                
                if (newBalance < BigInt(INITIAL_FUNDING_AMOUNT)) {
                    throw new Error('Funding transaction completed but balance is still insufficient');
                }
                
               
                console.log('Creating account instance for deployment...');
                const newAccount = new Account(provider, contractAddress, privateKey);
                
                console.log('Deploying account...');
                const deployAccountPayload = {
                    classHash: ARGENT_X_ACCOUNT_CLASS_HASH,
                    constructorCalldata: constructorCallData,
                    contractAddress: contractAddress,
                    addressSalt: starkKeyPub,
                    version: TRANSACTION_VERSION
                };
                
                const { transaction_hash: deployTxHash } = await newAccount.deployAccount(deployAccountPayload);
                
                console.log("Account deployment transaction hash:", deployTxHash);
                await provider.waitForTransaction(deployTxHash);
                
                console.log('Account deployed successfully!');
                
               
                user.status = true;
                await user.save();
                
               
                walletInfo.deployed = true;
                walletInfo.deployedAt = new Date().toISOString();
                walletInfo.deployTxHash = deployTxHash;
                fs.writeFileSync(tempFilePath, JSON.stringify(walletInfo, null, 2));
                
                return {
                    success: true,
                    message: "Account created and deployed successfully",
                    address: contractAddress
                };
            } catch (fundingError) {
                console.error("Error during funding or deployment:", fundingError);
                return {
                    success: false,
                    message: "Failed to fund or deploy account: " + fundingError.message,
                    address: contractAddress
                };
            }
        } else {
            console.log('No admin account available for funding. Account created but not deployed.');
            return {
                success: true,
                message: "Account created but not active. Requires funding",
                address: contractAddress
            };
        }
    } catch (error) {
        console.error("Account creation error", error);
        return {
            success: false,
            message: error.message || "Failed to create account", 
            error
        };
    }
}

exports.ussdAccess = async (req, res) => {
    const {sessionId, serviceCode, phoneNumber, text} = req.body;

    let response; 
    let fullName = '';
    let passcode = '';
    
    if(text == ''){
        response = 'CON Welcome to Starknet Wallet \n 1. Create an account \n 2. Check wallet balance'
    }

    else if(text == '1') {
        response = 'CON Enter full name ';
    }

    else if(text == '2') {
        try {
            const userExist = await User.findOne({ where: { phoneNumber } });

            if (!userExist){
                response = 'END You do not have an account. Please create one';
            } else {
               
                if (!userExist.status) {
                    response = 'END Your wallet is not yet active. Please wait for deployment.';
                } else {
                    const balance = await checkBalance(provider, userExist.walletAddress);
                    response = `END Your wallet balance: ${Number(balance) / 1e18} STRK`;
                }
            }
        } catch (error) {
            response = 'END Could not check balance at the moment';
            console.error("Balance check error:", error);
        }
    }

    else if(text == '3') {
        try {
            const userExist = await User.findOne({ where: { phoneNumber } });
            
            if (!userExist) {
                response = 'END You do not have an account. Please create one';
            } else {
                const address = userExist.walletAddress;
                const shortAddress = `${address.substring(0, 8)}...${address.substring(address.length - 6)}`;
                response = `END Your wallet address:\n${shortAddress}\n\nStatus: ${userExist.status ? 'Active' : 'Pending'}`;
            }
        } catch (error) {
            console.error("Address retrieval error:", error);
            response = 'END Could not retrieve your wallet address';
        }
    }

    else if(text !== '') {
        let array = text.split('*')

        if(array.length === 2) {
            if(parseInt(array[0]) == 1) {
                fullName = array[1]
                response = 'CON Enter your passcode'
            }
        }

        if(array.length === 3) {
            if(parseInt(array[0]) == 1) {
                fullName = array[1]
                passcode = array[2]

                if(!fullName || !phoneNumber || !passcode) {
                    response = 'END Incomplete signup details'
                }

                try {
                    const userExist = await User.findOne({ where: { phoneNumber } });
                
                    console.log("existence of user", userExist)
                
                    if (userExist) {
                        response = "END You already have an account"; 
                    } else {
                        response = 'END Creating account, you will receive an SMS when complete';
                        createAndDeployAccount(fullName, phoneNumber, passcode).then(async (result) => {
                            console.log("Account creation result:", result);
                
                            if (result.success){
                                try {
                                    await africaStalking.SMS.send({
                                        to: phoneNumber,
                                        message: `Your Starknet wallet has been created. Your wallet address: ${result.address.substring(0, 8)}...${result.address.substring(result.address.length - 6)}`
                                    });
                                } catch (smsError) {
                                    console.error("SMS sending error", smsError);
                                }
                            }
                        })
                        .catch(error => {
                            console.error("Account creation error", error);
                        });
                    }
                } catch (error) {
                    response = `END Error: ${error.message || "Unknown error"}`;
                }
            } 
        } 
    } 

    res.set('Content-Type', 'text/plain');
    res.send(response);
}

module.exports = exports;