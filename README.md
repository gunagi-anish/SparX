# SparX College Management System

A comprehensive college management system for Sahyadri College of Engineering and Management.

## Features

- Student management
- Staff management
- Course management
- Attendance tracking
- Marks management
- Attendance reports
- Attendance notification emails

## New Feature: Attendance Notification Emails

The system now includes a feature for staff to send email notifications to students with attendance below 75%.

### How it works:

1. Staff can view attendance reports for their classes
2. Students with attendance below 75% will be highlighted
3. Staff can select specific students or all students with low attendance
4. Automated email notifications are sent to the selected students

### Setting up Email Functionality:

1. **Configure Environment Variables:**
   - Create/edit `.env` file in the project root
   - Add the following variables:
   ```
   MAILGUN_API_KEY=your-mailgun-api-key
   DOMAIN_NAME=your-domain-name.com
   ```

2. **Test Email Functionality:**
   - Log in as a staff member
   - Go to the dashboard
   - Use the "Send Test Email" button in the System Tools section

For detailed setup instructions, see the `email-setup-instructions.md` file.

## Setup and Installation

1. Clone the repository
2. Install dependencies: `npm install`
3. Configure environment variables (see `.env.sample`)
4. Set up the database: Import `database/cms.sql`
5. Start the application: `npm start`

## Technologies Used

- Node.js
- Express.js
- MySQL
- EJS Templates
- Bootstrap
- Mailgun (for email notifications)
