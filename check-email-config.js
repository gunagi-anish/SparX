// Script to verify email configuration
require('dotenv').config();

console.log('=========== Email Configuration Check ===========');

// Check for Email User
const emailUser = process.env.EMAIL_USER;
if (emailUser) {
  console.log('✅ EMAIL_USER is configured');
  // Show email with some parts obscured for security
  const emailHint = emailUser.substring(0, 3) + '***' + emailUser.substring(emailUser.indexOf('@'));
  console.log(`   Email: ${emailHint}`);
} else {
  console.log('❌ EMAIL_USER is missing');
  console.log('   Please add your Gmail address to the .env file as EMAIL_USER');
}

// Check for Email Password
const emailPassword = process.env.EMAIL_PASSWORD;
if (emailPassword) {
  console.log('✅ EMAIL_PASSWORD is configured');
  console.log(`   Password: ${'*'.repeat(8)} (hidden for security)`);
} else {
  console.log('❌ EMAIL_PASSWORD is missing');
  console.log('   Please add your Gmail app password to the .env file as EMAIL_PASSWORD');
  console.log('   Learn how to create an app password: https://support.google.com/accounts/answer/185833');
}

// Check other essential environment variables
const essentialVars = [
  'PORT', 
  'URL', 
  'SESSION_SECRET', 
  'JWT_SECRET', 
  'JWT_EXPIRE', 
  'RESET_PASSWORD_KEY',
  'DB_HOST',
  'DB_USER',
  'DB_NAME'
];

console.log('\n=========== Other Essential Configurations ===========');
let missingVars = 0;
essentialVars.forEach(varName => {
  if (process.env[varName]) {
    console.log(`✅ ${varName} is configured`);
  } else {
    console.log(`❌ ${varName} is missing`);
    missingVars++;
  }
});

// Summary
console.log('\n=========== Configuration Summary ===========');
if (emailUser && emailPassword) {
  console.log('✅ Email configuration is complete');
} else {
  console.log('❌ Email configuration is incomplete');
}

if (missingVars === 0) {
  console.log('✅ All other essential configurations are present');
} else {
  console.log(`❌ ${missingVars} essential configurations are missing`);
}

console.log('\nTo fix any missing configurations, update your .env file according to the instructions in env-instructions.txt');

// Additional information about Gmail app passwords
if (!emailPassword) {
  console.log('\n=========== Setting up Gmail App Password ===========');
  console.log('1. Go to your Google Account at https://myaccount.google.com/');
  console.log('2. Select "Security"');
  console.log('3. Under "Signing in to Google", select "App passwords"');
  console.log('   (You might need to enable 2-Step Verification first)');
  console.log('4. Select "Mail" as the app and "Other" as the device');
  console.log('5. Enter "Sahyadri College Management" as the name');
  console.log('6. Click "Generate"');
  console.log('7. Copy the 16-character password');
  console.log('8. Add this password to your .env file as EMAIL_PASSWORD');
} 