require("dotenv").config();
const africaStalkingData = require("africastalking");
const { User, Transaction } = require('../models');
const { Op } = require('sequelize');
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
const NODE_URL = process.env.STARKNET_PROVIDER_URL || 'https://free-rpc.nethermind.io/sepolia-juno/v0_7';
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
            
            if (response && response.length > 0) {
                return BigInt(response[0]);
            }
            
            throw new Error('Could not retrieve balance through any method');
        }
    } catch (error) {
        console.warn('Could not check balance:', error.message);
        return 0n;
    }
}

async function transferTokens(senderAddress, privateKey, recipientAddress, amount) {
    try {
        console.log(`Initiating transfer of ${amount} STRK from ${senderAddress} to ${recipientAddress}`);
        
        const senderAccount = new Account(provider, senderAddress, privateKey);
        
        const senderBalance = await checkBalance(provider, senderAddress);
        console.log(`Sender balance: ${senderBalance} wei (${Number(senderBalance) / 1e18} STRK)`);
        
        const amountInWei = BigInt(Math.floor(parseFloat(amount) * 1e18)).toString();
        
        if (BigInt(senderBalance) < BigInt(amountInWei)) {
            return {
                success: false,
                message: "Insufficient balance for transfer"
            };
        }
        
        const transferCall = {
            contractAddress: STRK_CONTRACT,
            entrypoint: 'transfer',
            calldata: [recipientAddress, amountInWei, 0]
        };
        
        const { transaction_hash: transferTxHash } = await senderAccount.execute(transferCall, undefined, {
            maxFee: '100000000000000',
            version: TRANSACTION_VERSION
        });
        
        console.log("Transfer transaction hash:", transferTxHash);
        
        await provider.waitForTransaction(transferTxHash);
        
        return {
            success: true,
            message: "Transfer completed successfully",
            txHash: transferTxHash
        };
    } catch (error) {
        console.error("Transfer error:", error);
        return {
            success: false,
            message: error.message || "Failed to complete transfer"
        };
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
        response = 'CON Welcome to Starknet Wallet \n 1. Create an account \n 2. Check wallet balance \n 3. Transfer'
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
            } else if (!userExist.status) {
                response = 'END Your wallet is not yet active. Please wait for deployment.';
            } else {
                response = 'CON Enter recipient username or phone number';
            }
        } catch (error) {
            console.error("Transfer initiation error:", error);
            response = 'END Could not initiate transfer';
        }
    }

    else if(text !== '') {
        let array = text.split('*')
        
        if(parseInt(array[0]) == 3) {
            if(array.length === 2) {
                const recipientIdentifier = array[1];
                
                try {
                    const recipient = await User.findOne({
                        where: {
                            [Op.or]: [
                                { safiriUsername: recipientIdentifier },
                                { phoneNumber: recipientIdentifier }
                            ],
                            status: true
                        }
                    });

                    if (!recipient) {
                        response = 'END Recipient not found or wallet not active';
                    } else {
                        console.log('Recipient found:', recipient);
                        response = 'CON Enter amount to transfer (STRK) to ' + recipient.fullName;
                    }
                } catch (error) {
                    console.error("Recipient lookup error:", error);
                    response = 'END Could not find recipient';
                }
            }
            
            if(array.length === 3) {
                const recipientIdentifier = array[1];
                const amount = array[2];
                
                if (isNaN(amount) || parseFloat(amount) <= 0) {
                    response = 'END Please enter a valid amount';
                } else {
                    response = 'CON Enter your PIN to confirm transfer';
                }
            }
            
            if(array.length === 4) {
                const recipientIdentifier = array[1];
                const amount = array[2];
                const userPin = array[3];
                
                try {
                    const sender = await User.findOne({ where: { phoneNumber } });
                    
                    const recipient = await User.findOne({
                        where: {
                            [Op.or]: [
                                { safiriUsername: recipientIdentifier },
                                { phoneNumber: recipientIdentifier }
                            ],
                            status: true
                        }
                    });
                    
                    if (!sender) {
                        response = 'END You do not have an account';
                    } else if (sender.pin != userPin) {
                        response = 'END Incorrect PIN';
                    } else if (!recipient) {
                        response = 'END Recipient not found or wallet not active';
                    } else if (sender.phoneNumber === recipient.phoneNumber) {
                        response = 'END You cannot transfer to your own account';
                    } else {
                        response = 'END Transfer initiated. You will receive an SMS confirmation.';
                        
                        transferTokens(sender.walletAddress, sender.privateKey, recipient.walletAddress, amount)
                            .then(async (result) => {
                                let message;
                                if (result.success) {
                                    await Transaction.create({
                                        user_id: sender.id,
                                        txHash: result.txHash,
                                        amount: parseFloat(amount),
                                        serviceBeneficiary: recipient.safiriUsername || recipient.phoneNumber,
                                        date: new Date()
                                    });
                                    message = `Transfer of ${amount} STRK to ${recipient.safiriUsername || recipient.phoneNumber} completed successfully.`;
                                } else {
                                    message = `Transfer failed: ${result.message}`;
                                }
                                
                                console.log(result, message);
                                
                                // We can send SMS to the user when the transaction is successful or not
                                /*try {
                                    await africaStalking.SMS.send({
                                        to: phoneNumber,
                                        message
                                    });
                                } catch (smsError) {
                                    console.error("SMS sending error", smsError);
                                }*/
                            })
                            .catch(error => {
                                console.error("Transfer execution error", error);
                            });
                    }
                } catch (error) {
                    console.error("Transfer processing error:", error);
                    response = 'END Could not process transfer';
                }
            }
        }
    } 

    res.set('Content-Type', 'text/plain');
    res.send(response);
}

module.exports = exports;
