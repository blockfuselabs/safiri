require("dotenv").config();

const {splitPK, encryptKey, decryptKey} = require("../utils/tool")
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
    cairo,
    CairoOption,
    CairoOptionVariant,
    CairoCustomEnum
} = require('starknet');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { sendSMS, messages } = require('./smsService');
const generateSafiriUsername  = require('./usernameGeneration');

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
const INITIAL_FUNDING_AMOUNT = process.env.FUNDING_AMOUNT || '0.0001';

const provider = new RpcProvider({ nodeUrl: NODE_URL });

let adminAccount;
if(adminPrivateKey && adminAccountAddress) {
    adminAccount = new Account(provider, adminAccountAddress, adminPrivateKey);
}


const STRK_CONTRACT = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH_CONTRACT = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

async function checkBalance(provider, address, contractAddress = STRK_CONTRACT) {
    try {
        try {
            const contract = new Contract(contractAddress, provider);
            const balance = await contract.getBalance(address);
            console.log("Standard getBalance response:", balance);
            if (balance && balance.length > 0) {
                return BigInt(balance[0]);
            }
            return BigInt(balance);
        } catch (e) {
            console.log('Standard getBalance failed, trying alternative method...');
            
            console.log("Contract address:", contractAddress);
           
            const response = await provider.callContract({
                contractAddress: contractAddress,
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

async function fundAccount(provider, address) {
    await provider.getChainId();
    console.log("Provider connected successfully.");
    
    const senderAccount = new Account(
        provider, 
        adminAccountAddress, 
        adminPrivateKey,
        '1'
    );
    
    try {
        console.log("Preparing transaction...");
        
        const amountInWei = BigInt(Math.floor(INITIAL_FUNDING_AMOUNT * 1e18));
        
        const uint256Amount = cairo.uint256(amountInWei);
        
        const transferCall = {
            contractAddress: ETH_CONTRACT,
            entrypoint: 'transfer',
            calldata: CallData.compile({
                recipient: address,
                amount: uint256Amount
            })
        };

        console.log("Transfer call data:", transferCall);
        console.log("Sender account address:", senderAccount.address);
        console.log("Recipient address:", address);
        console.log("Amount to transfer:", uint256Amount);
        console.log("Sender account private key:", adminPrivateKey);
        
        console.log("Executing transaction with fixed fee...");
        
        const maxFee = "100000000000000";
        
        const { transaction_hash: transferTxHash } = await senderAccount.execute(transferCall, undefined, {
            maxFee: maxFee,
            version: TRANSACTION_VERSION
        });
        
        console.log("Transfer transaction hash:", transferTxHash);
        
        console.log("Waiting for transaction confirmation...");
        try {
            await provider.waitForTransaction(transferTxHash, { retryInterval: 2000, maxRetries: 10 });
            console.log('Transfer completed, transaction hash:', transferTxHash);
            return transferTxHash;
        } catch (waitError) {
            console.warn("Transaction submitted but couldn't confirm:", waitError.message);
            console.log("The transaction might still go through. Check the hash:", transferTxHash);
            return transferTxHash;
        }
    } catch (error) {
        console.error("Error details:", error);
        
        if (error.message?.includes("fetch failed")) {
            console.error("Network connectivity issue. Please check your internet connection or try a different RPC provider.");
        } else if (error.message?.includes("signature")) {
            console.error("Signature validation failed. Check if your private key and account address are correct.");
        } else if (error.message?.includes("insufficient funds")) {
            console.error("Insufficient funds for the transaction. Make sure your account has enough ETH.");
        }
        
        throw error;
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
        
        
        /**
         * Encrypt the private key using a symmetric encryption algorithm
         * 1. We generate a wallet for the user
         * 2. We split the private key into two parts
         * 3. We encrypt the private key using a symmetric encryption algorithm by using the first half/part of the private key as the key to encrypt the private key
         * 4. We concatenate the encrypted private key with the first half/part of the private key
         * 5. We save the encrypted private key in the database
         **/
    
        const [firstHalf] = splitPK(privateKey);
        const encryptedKey = `${encryptKey(privateKey, firstHalf)}${firstHalf}`;

        const safiriUsername = await generateSafiriUsername(fullName);
        
        const user = await User.create({
            fullName,
            phoneNumber,
            safiriUsername: safiriUsername,
            walletAddress: contractAddress,
            privateKey: encryptedKey,
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
        
        // const tempFilePath = `./wallet-info-${phoneNumber.replace(/[^0-9]/g, '')}.json`;
        // fs.writeFileSync(tempFilePath, JSON.stringify(walletInfo, null, 2));
        // console.log(`Wallet information saved to ${tempFilePath}`);

        console.log('--- Wallet Information ---');
        console.log('Private Key:', privateKey);
        console.log('Public Key:', starkKeyPub);
        console.log('Address:', contractAddress);
        console.log('Encrypted Private Key:', encryptedKey);
        console.log('User ID:', user.id);
        console.log('User Phone:', phoneNumber);
        console.log('--- End of Wallet Information ---');
        
        // === STEP 2: Fund and deploy the account ===
        console.log('\n=== STEP 2: Deploying wallet ===');
        
       
        if (adminAccount) {
            
            const adminBalance = await checkBalance(provider, adminAccountAddress, ETH_CONTRACT);
            console.log(`Admin account balance: ${adminBalance} wei (${Number(adminBalance) / 1e18} STRK)`);
            
            if (adminBalance < BigInt(INITIAL_FUNDING_AMOUNT * 1e18)) {
                console.error('Admin account has insufficient funds for initial funding');
                return {
                    success: false,
                    message: "Admin account has insufficient funds",
                    address: contractAddress
                };
            }
            
            // Fund the new account
            console.log(`Funding account ${contractAddress} with ${Number(INITIAL_FUNDING_AMOUNT) / 1e18} ETH`);
            await fundAccount(provider, contractAddress);
                
              
            console.log('Checking new account balance...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const newBalance = await checkBalance(provider, contractAddress, ETH_CONTRACT);
            console.log(`New account balance: ${newBalance} wei (${Number(newBalance) / 1e18} ETH)`);
            
            if (newBalance < BigInt(INITIAL_FUNDING_AMOUNT * 1e18)) {
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
            
            
            // walletInfo.deployed = true;
            // walletInfo.deployedAt = new Date().toISOString();
            // walletInfo.deployTxHash = deployTxHash;
            // fs.writeFileSync(tempFilePath, JSON.stringify(walletInfo, null, 2));
            
            return {
                success: true,
                message: "Account created and deployed successfully",
                address: contractAddress
            };
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

const ussdAccess = async (req, res) => {
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
                    sendSMS(phoneNumber, messages.accountBalance(userExist.walletAddress, Number(balance) / 1e18));
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

    // More complex logics
    else if(text !== '') {
        
        let array = text.split('*')

        if(array.length < 1) {
            response = 'END Invalid input';
        }
        
        // Create account option
        if(parseInt(array[0]) == 1){
            console.log(`Registration Array 1: ${array}`)
            if(array.length === 2) {
                if(parseInt(array[0]) == 1) {
                    fullName = array[1]
                    response = 'CON Enter your passcode'
                }
            }
            
            if(array.length === 3) {
                console.log(`Registration Array 2: ${array}`)
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
                                        await sendSMS(phoneNumber, messages.accountCreated(result.address))
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

        // Transfer option
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
                
                console.log(`TF Amount Array: ${array}`)

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
                        
                        transferTokens(sender.walletAddress, decryptKey(sender.privateKey), recipient.walletAddress, amount)
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
                                    const recipientAddress = recipient.safiriUsername;
                                    await sendSMS(phoneNumber, messages.transactionSuccess(result.txHash, amount, recipientAddress));
                                } else {
                                    message = `Transfer failed: ${result.message}`;
                                    sendSMS(phoneNumber, messages.transactionFailed(result.message));
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

// Add new function to handle transaction notifications
async function sendTransactionNotification(phoneNumber, success, details) {
    try {
        const message = success 
            ? messages.transactionSuccess(details.txHash, details.amount)
            : messages.transactionFailed(details.error);
            
        await sendSMS(phoneNumber, message);
    } catch (error) {
        console.error('Failed to send transaction notification:', error);
    }
}

// Example usage in a transaction function
async function processTransaction(userPhone, amount, beneficiary) {
    try {
        // Your transaction logic here
        const txResult = await performTransaction();
        
        // Send success notification
        await sendTransactionNotification(userPhone, true, {
            txHash: txResult.hash,
            amount: amount
        });
        
        return txResult;
    } catch (error) {
        // Send failure notification
        await sendTransactionNotification(userPhone, false, {
            error: error.message
        });
        
        throw error;
    }
}

module.exports = {
    ussdAccess,
    createAndDeployAccount,
    sendTransactionNotification
};