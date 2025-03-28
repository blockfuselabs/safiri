require("dotenv").config();
const africaStalkingData = require("africastalking");

const africaStalking = africaStalkingData({
    apiKey: process.env.AFRICA_STALKING_API_KEY || "",
    username: process.env.AFRICA_STALKING_USERNAME || 'sandbox',
});

async function sendSMS(phoneNumber, message) {
    try {
        const result = await africaStalking.SMS.send({
            to: phoneNumber,
            message: message
        });
        console.log('SMS sent successfully:', result);
        return result;
    } catch (error) {
        console.error('SMS sending failed:', error);
        throw error;
    }
}

// Message templates
const messages = {
    accountCreated: (address) => 
        `Your Starknet wallet has been created successfully! Your wallet address: ${address.substring(0, 8)}...${address.substring(address.length - 6)}`,
    
    accountDeploymentFailed: () =>
        `Your wallet creation encountered an issue. Our team will look into it and get back to you.`,
    
    transactionSuccess: (txHash, amount) =>
        `Transaction successful! Amount: ${amount} STRK. Hash: ${txHash.substring(0, 8)}...`,
    
    transactionFailed: (error) =>
        `Transaction failed. Error: ${error}. Please try again later.`
};

module.exports = {
    sendSMS,
    messages
}; 