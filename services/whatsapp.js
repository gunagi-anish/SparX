const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Create a new WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox']
    }
});

// Initialize WhatsApp client
client.initialize();

// Handle QR code generation
client.on('qr', (qr) => {
    console.log('QR Code received. Please scan with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

// Handle client ready event
client.on('ready', () => {
    console.log('WhatsApp client is ready!');
});

// Handle client authentication failure
client.on('auth_failure', (msg) => {
    console.error('WhatsApp authentication failed:', msg);
});

// Function to send WhatsApp message
async function sendWhatsAppMessage(phoneNumber, message) {
    try {
        // Format phone number (remove any non-numeric characters)
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        
        // Add country code if not present (assuming Indian numbers)
        const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;
        
        // Create chat ID (phone number with @c.us suffix)
        const chatId = `${formattedPhone}@c.us`;
        
        // Send message
        const response = await client.sendMessage(chatId, message);
        return response;
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        throw error;
    }
}

module.exports = {
    client,
    sendWhatsAppMessage
}; 