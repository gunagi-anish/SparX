const express = require('express');
const controller = require('../controllers/staff');
const { requireAuth, forwardAuth } = require('../middlewares/staffAuth');

const router = express.Router();

// login page
router.get('/login', forwardAuth, controller.getLogin);
router.post('/login', controller.postLogin);

router.get('/dashboard', requireAuth, controller.getDashboard);
router.get('/profile', requireAuth, controller.getProfile);
router.get('/logout', requireAuth, controller.getLogout);

router.get('/student-attendance', requireAuth, controller.getAttendance);
// router.get('/student-attendance/class/:id', requireAuth, controller.markAttendance);

router.post(
  '/student-attendance/class/:id',
  requireAuth,
  controller.postAttendance
);

router.get('/timetable', requireAuth, controller.getTimeTable);

router.post('/student-attendance', requireAuth, controller.markAttendance);

router.get('/student-report', requireAuth, controller.getStudentReport);
router.get('/student-report/class/:id', requireAuth, controller.getStudentReportDetails);

router.get('/class-report', requireAuth, controller.selectClassReport);
router.get('/class-report/class/:id', requireAuth, controller.getClassReport);
router.get('/class-report/:id/download', requireAuth, controller.downloadClassReport);
router.get('/class-report/:id/download-excel', requireAuth, controller.downloadClassReportExcel);

// Add email notification route
router.post('/class-report/send-notification', requireAuth, controller.sendAttendanceNotification);

// Test email route
router.get('/test-email', requireAuth, controller.testEmail);

// 1.5 FORGET PASSWORD
router.get('/forgot-password', forwardAuth, controller.getForgotPassword);
router.put('/forgot-password', controller.forgotPassword);

// 1.6 RESET PASSWORD
router.get('/resetpassword/:id', forwardAuth, controller.getResetPassword);
router.put('/resetpassword', controller.resetPassword);

module.exports = router;
