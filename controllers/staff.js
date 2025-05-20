const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pdf = require('html-pdf');
const path = require('path');
const ExcelJS = require('exceljs');
const axios = require('axios');

// Replace Mailgun with Nodemailer
const nodemailer = require('nodemailer');

// Create a nodemailer transporter using Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASSWORD || 'your-app-password'
  }
});

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  dateStrings: 'date',
  database: 'cumsdbms',
});

// Database query promises
const zeroParamPromise = (sql) => {
  return new Promise((resolve, reject) => {
    db.query(sql, (err, results) => {
      if (err) return reject(err);
      return resolve(results);
    });
  });
};

const queryParamPromise = (sql, queryParam) => {
  return new Promise((resolve, reject) => {
    db.query(sql, queryParam, (err, results) => {
      if (err) return reject(err);
      return resolve(results);
    });
  });
};

// LOGIN
exports.getLogin = (req, res, next) => {
  res.render('Staff/login');
};

exports.postLogin = async (req, res, next) => {
  const { email, password } = req.body;
  let errors = [];
  const sql1 = 'SELECT * FROM staff WHERE email = ?';
  const users = await queryParamPromise(sql1, [email]);
  if (
    users.length === 0 ||
    !(await bcrypt.compare(password, users[0].password))
  ) {
    errors.push({ msg: 'Email or Password is Incorrect' });
    res.status(401).render('Staff/login', { errors });
  } else {
    const token = jwt.sign({ id: users[0].st_id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE,
    });
    res.cookie('jwt', token, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.redirect('/staff/dashboard');
  }
};

exports.getDashboard = async (req, res, next) => {
  const sql1 = 'SELECT * FROM staff WHERE st_id = ?';
  const user = req.user;
  const data = await queryParamPromise(sql1, [user]);
  res.render('Staff/dashboard', { user: data[0], page_name: 'overview' });
};

exports.getProfile = async (req, res, next) => {
  const sql1 = 'SELECT * FROM staff WHERE st_id = ?';
  const user = req.user;
  const data = await queryParamPromise(sql1, [user]);
  const userDOB = data[0].dob;
  const sql2 = 'SELECT d_name FROM department WHERE dept_id = ?';
  const deptData = await queryParamPromise(sql2, [data[0].dept_id]);

  const sql3 =
    'SELECT cl.class_id, cl.section, cl.semester, cl.c_id, co.name FROM class AS cl, course AS co WHERE st_id = ? AND co.c_id = cl.c_id;';
  const classData = await queryParamPromise(sql3, [data[0].st_id]);

  res.render('Staff/profile', {
    user: data[0],
    userDOB,
    deptData,
    classData,
    page_name: 'profile',
  });
};

exports.getTimeTable = async (req, res, next) => {
  const staffData = (
    await queryParamPromise('SELECT * FROM staff WHERE st_id = ?', [req.user])
  )[0];
  const timeTableData = await queryParamPromise(
    'select * from time_table where st_id = ? order by day, start_time',
    [req.user]
  );
  console.log(timeTableData);
  const startTimes = ['10:00', '11:00', '12:00', '13:00'];
  const endTimes = ['11:00', '12:00', '13:00', '14:00'];
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  res.render('Staff/timetable', {
    page_name: 'timetable',
    timeTableData,
    startTimes,
    staffData,
    endTimes,
    dayNames,
  });
};

exports.getAttendance = async (req, res, next) => {
  const sql1 = 'SELECT * FROM staff WHERE st_id = ?';
  const user = req.user;
  const data = await queryParamPromise(sql1, [user]);

  const sql3 =
    'SELECT cl.class_id, cl.section, cl.semester, cl.c_id, co.name FROM class AS cl, course AS co WHERE st_id = ? AND co.c_id = cl.c_id ORDER BY cl.semester;';
  const classData = await queryParamPromise(sql3, [data[0].st_id]);

  res.render('Staff/selectClassAttendance', {
    user: data[0],
    classData,
    btnInfo: 'Students List',
    page_name: 'attendance',
  });
};

exports.markAttendance = async (req, res, next) => {
  const { classdata, date } = req.body;
  const regex1 = /[A-Z]+[0-9]+/g;
  const regex2 = /[A-Z]+-[0-9]+/g;

  const c_id = classdata.match(regex1)[0];
  const class_sec = classdata.match(regex2)[0].split('-');
  const staffId = req.user;

  // Get staff data
  const sql1 = 'SELECT * FROM staff WHERE st_id = ?';
  const staffData = await queryParamPromise(sql1, [staffId]);

  const sql = `
    SELECT * FROM student WHERE dept_id = ? AND section = ?
`;

  let students = await queryParamPromise(sql, [class_sec[0], class_sec[1]]);
  for (student of students) {
    const status = await queryParamPromise(
      'SELECT status FROM attendance WHERE c_id = ? AND s_id = ? AND date = ?',
      [c_id, student.s_id, date]
    );
    if (status.length !== 0) {
      student.status = status[0].status;
    } else {
      student.status = 0;
    }
  }

  return res.render('Staff/attendance', {
    studentData: students,
    courseId: c_id,
    date,
    user: staffData[0],
    page_name: 'attendance',
  });
};

exports.postAttendance = async (req, res, next) => {
  try {
    const { date, courseId, ...students } = req.body;
    console.log('Received attendance data:', { date, courseId, studentCount: Object.keys(students).length });
    
    // Process each student individually
    for (const s_id in students) {
      const isPresent = students[s_id] === 'True' ? 1 : 0;
      console.log(`Processing student ${s_id}: ${isPresent ? 'Present' : 'Absent'}`);
      
      // Check if a record already exists for this student, date, and course
      const existingRecord = await queryParamPromise(
        'SELECT * FROM attendance WHERE s_id = ? AND date = ? AND c_id = ?',
        [s_id, date, courseId]
      );
      
      if (existingRecord.length === 0) {
        // Insert new record
        console.log(`Inserting new attendance record for student ${s_id}`);
        await queryParamPromise('INSERT INTO attendance SET ?', {
          s_id: s_id,
          date: date,
          c_id: courseId,
          status: isPresent
        });
      } else {
        // Update existing record
        console.log(`Updating attendance record for student ${s_id}`);
        await queryParamPromise(
          'UPDATE attendance SET status = ? WHERE s_id = ? AND date = ? AND c_id = ?',
          [isPresent, s_id, date, courseId]
        );
      }
    }
    
    req.flash('success_msg', 'Attendance updated successfully');
    return res.redirect('/staff/student-attendance');
  } catch (err) {
    console.error('Error in postAttendance:', err);
    req.flash('error_msg', 'Error updating attendance');
    return res.redirect('/staff/student-attendance');
  }
};

exports.getStudentReport = async (req, res, next) => {
  const sql1 = 'SELECT * FROM staff WHERE st_id = ?';
  const user = req.user;
  const data = await queryParamPromise(sql1, [user]);

  const sql3 =
    'SELECT cl.class_id, cl.section, cl.semester, cl.c_id, co.name FROM class AS cl, course AS co WHERE st_id = ? AND co.c_id = cl.c_id ORDER BY cl.semester;';
  const classData = await queryParamPromise(sql3, [data[0].st_id]);

  res.render('Staff/selectClass', {
    user: data[0],
    classData,
    btnInfo: 'Students',
    page_name: 'stu-report',
  });
};

exports.getStudentReportDetails = async (req, res, next) => {
  try {
    const courseId = req.params.id;
    const section = req.query.section;
    const staffId = req.user;

    console.log('Generating student report for:', { courseId, section, staffId });

    // Get staff data
    const staffData = await queryParamPromise('SELECT * FROM staff WHERE st_id = ?', [staffId]);
    if (!staffData || staffData.length === 0) {
      console.error('Staff not found:', staffId);
      req.flash('error_msg', 'Staff not found');
      return res.redirect('/staff/student-report');
    }

    // Get class data with department info
    const classData = await queryParamPromise(
      'SELECT cl.*, co.name as course_name, co.dept_id FROM class cl JOIN course co ON cl.c_id = co.c_id WHERE cl.c_id = ? AND cl.st_id = ? AND cl.section = ?',
      [courseId, staffId, section]
    );

    if (!classData || classData.length === 0) {
      console.error('Class not found:', { courseId, section });
      req.flash('error_msg', 'Class not found');
      return res.redirect('/staff/student-report');
    }

    console.log('Found class data:', classData[0]);

    // Get students in this class
    const students = await queryParamPromise(
      'SELECT s.* FROM student s WHERE s.dept_id = ? AND s.section = ?',
      [classData[0].dept_id, parseInt(section)]
    );

    console.log('Found students:', students.length);

    // Get attendance and marks for each student
    const studentStats = [];
    for (const student of students) {
      try {
        // Get attendance stats
        const totalClasses = await queryParamPromise(
          'SELECT COUNT(DISTINCT date) as total FROM attendance WHERE c_id = ?',
          [courseId]
        );
        
        const attendedClasses = await queryParamPromise(
          'SELECT COUNT(*) as attended FROM attendance WHERE c_id = ? AND s_id = ? AND status = 1',
          [courseId, student.s_id]
        );

        // Get marks
        const marks = await queryParamPromise(
          'SELECT internal_marks, external_marks FROM marks WHERE c_id = ? AND s_id = ?',
          [courseId, student.s_id]
        );

        const attendancePercentage = totalClasses[0].total > 0 
          ? ((attendedClasses[0].attended / totalClasses[0].total) * 100).toFixed(2)
          : 0;

        studentStats.push({
          s_id: student.s_id,
          name: student.s_name,
          email: student.email,
          attendance: {
            total_classes: totalClasses[0].total || 0,
            attended_classes: attendedClasses[0].attended || 0,
            percentage: attendancePercentage
          },
          marks: marks.length > 0 ? {
            internal: marks[0].internal_marks || 0,
            external: marks[0].external_marks || 0,
            total: (marks[0].internal_marks || 0) + (marks[0].external_marks || 0)
          } : {
            internal: 0,
            external: 0,
            total: 0
          }
        });
      } catch (err) {
        console.error('Error processing student:', student.s_id, err);
        // Continue with next student even if one fails
        continue;
      }
    }

    console.log('Generated stats for students:', studentStats.length);

    res.render('Staff/studentReport', {
      user: staffData[0],
      classData: classData[0],
      studentStats,
      page_name: 'stu-report'
    });
  } catch (err) {
    console.error('Error in getStudentReportDetails:', err);
    req.flash('error_msg', 'Error generating student report');
    res.redirect('/staff/student-report');
  }
};

exports.selectClassReport = async (req, res, next) => {
  const sql1 = 'SELECT * FROM staff WHERE st_id = ?';
  const user = req.user;
  const data = await queryParamPromise(sql1, [user]);

  const sql3 =
    'SELECT cl.class_id, cl.section, cl.semester, cl.c_id, co.name FROM class AS cl, course AS co WHERE st_id = ? AND co.c_id = cl.c_id ORDER BY cl.semester;';
  const classData = await queryParamPromise(sql3, [data[0].st_id]);

  res.render('Staff/selectClassReport', {
    user: data[0],
    classData,
    btnInfo: 'Check Status',
    page_name: 'cls-report',
  });
};

exports.getClassReport = async (req, res, next) => {
  const courseId = req.params.id;
  const staffId = req.user;
  const section = req.query.section;
  
  try {
    // Get class data with department info
    const classData = await queryParamPromise(
      'SELECT cl.*, co.name as course_name, co.dept_id FROM class cl JOIN course co ON cl.c_id = co.c_id WHERE cl.c_id = ? AND cl.st_id = ? AND cl.section = ?',
      [courseId, staffId, section]
    );

    if (!classData || classData.length === 0) {
      req.flash('error_msg', 'Class not found');
      return res.redirect('/staff/class-report');
    }

    // Get students in this class
    const students = await queryParamPromise(
      'SELECT s.* FROM student s WHERE s.dept_id = ? AND s.section = ?',
      [classData[0].dept_id, parseInt(section)]
    );

    // Get attendance data for each student
    const attendanceStats = [];
    for (const student of students) {
      const totalClasses = await queryParamPromise(
        'SELECT COUNT(DISTINCT date) as total FROM attendance WHERE c_id = ?',
        [courseId]
      );
      
      const attendedClasses = await queryParamPromise(
        'SELECT COUNT(*) as attended FROM attendance WHERE c_id = ? AND s_id = ? AND status = 1',
        [courseId, student.s_id]
      );

      const percentage = totalClasses[0].total > 0 
        ? ((attendedClasses[0].attended / totalClasses[0].total) * 100).toFixed(2)
        : 0;

      attendanceStats.push({
        s_id: student.s_id,
        name: student.s_name,
        total_classes: totalClasses[0].total,
        attended_classes: attendedClasses[0].attended,
        percentage: percentage
      });
    }

    const sql1 = 'SELECT * FROM staff WHERE st_id = ?';
    const staffData = await queryParamPromise(sql1, [staffId]);

    res.render('Staff/getClassReport', {
      user: staffData[0],
      classData: classData[0],
      attendanceStats,
      page_name: 'cls-report'
    });
  } catch (err) {
    console.error('Error in getClassReport:', err);
    req.flash('error_msg', 'Error generating class report');
    res.redirect('/staff/class-report');
  }
};

exports.getLogout = (req, res, next) => {
  res.cookie('jwt', '', { maxAge: 1 });
  req.flash('success_msg', 'You are logged out');
  res.redirect('/staff/login');
};

// FORGOT PASSWORD
exports.getForgotPassword = (req, res, next) => {
  res.render('Staff/forgotPassword');
};

exports.forgotPassword = async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).render('Staff/forgotPassword');
  }

  let errors = [];

  const sql1 = 'SELECT * FROM staff WHERE email = ?';
  const results = await queryParamPromise(sql1, [email]);
  if (!results || results.length === 0) {
    errors.push({ msg: 'That email is not registered!' });
    return res.status(401).render('Staff/forgotPassword', {
      errors,
    });
  }

  const token = jwt.sign(
    { _id: results[0].st_id },
    process.env.RESET_PASSWORD_KEY,
    { expiresIn: '20m' }
  );

  const data = {
    from: 'No Reply <noreply@' + DOMAIN + '>',
    to: email,
    subject: 'Reset Password Link',
    html: `<h2>Please click on given link to reset your password</h2>
                <p><a href="${process.env.URL}/staff/resetpassword/${token}">Reset Password</a></p>
                <hr>
                <p><b>The link will expire in 20m!</b></p>
              `,
  };

  const sql2 = 'UPDATE staff SET resetLink = ? WHERE email = ?';
  try {
    await queryParamPromise(sql2, [token, email]);
    
    try {
      const result = await transporter.sendMail(data);
      console.log('Reset password email sent successfully:', result);
      req.flash('success_msg', 'Reset Link Sent Successfully!');
      return res.redirect('/staff/forgot-password');
    } catch (mailErr) {
      console.error('Error sending reset password email:', mailErr);
      errors.push({ msg: 'Error Sending Email: ' + mailErr.message });
      return res.render('Staff/forgotPassword', { errors });
    }
  } catch (err) {
    errors.push({ msg: 'Error In ResetLink' });
    return res.render('Staff/forgotPassword', { errors });
  }
};

exports.getResetPassword = (req, res, next) => {
  const resetLink = req.params.id;
  res.render('Staff/resetPassword', { resetLink });
};

exports.resetPassword = (req, res, next) => {
  const { resetLink, password, confirmPass } = req.body;

  let errors = [];

  if (password !== confirmPass) {
    req.flash('error_msg', 'Passwords do not match!');
    res.redirect(`/staff/resetpassword/${resetLink}`);
  } else {
    if (resetLink) {
      jwt.verify(resetLink, process.env.RESET_PASSWORD_KEY, (err, data) => {
        if (err) {
          errors.push({ msg: 'Token Expired!' });
          res.render('Staff/resetPassword', { errors });
        } else {
          const sql1 = 'SELECT * FROM staff WHERE resetLink = ?';
          db.query(sql1, [resetLink], async (err, results) => {
            if (err || results.length === 0) {
              throw err;
            } else {
              let hashed = await bcrypt.hash(password, 8);

              const sql2 = 'UPDATE staff SET password = ? WHERE resetLink = ?';
              db.query(sql2, [hashed, resetLink], (errorData, retData) => {
                if (errorData) {
                  throw errorData;
                } else {
                  req.flash(
                    'success_msg',
                    'Password Changed Successfully! Login Now'
                  );
                  res.redirect('/staff/login');
                }
              });
            }
          });
        }
      });
    } else {
      errors.push({ msg: 'Authentication Error' });
      res.render('Staff/resetPassword', { errors });
    }
  }
};

exports.getAddMarks = async (req, res, next) => {
  try {
    const sql1 = 'SELECT * FROM staff WHERE st_id = ?';
    const staffData = await queryParamPromise(sql1, [req.user]);

    const sql2 = 'SELECT cl.class_id, cl.section, cl.semester, cl.c_id, co.name FROM class AS cl, course AS co WHERE st_id = ? AND co.c_id = cl.c_id ORDER BY cl.semester;';
    const classData = await queryParamPromise(sql2, [staffData[0].st_id]);

    res.render('Staff/selectClassMarks', {
      user: staffData[0],
      classData,
      btnInfo: 'Add Marks',
      page_name: 'marks'
    });
  } catch (err) {
    console.error(err);
    req.flash('error_msg', 'Error loading classes');
    res.redirect('/staff/dashboard');
  }
};

exports.getClassMarks = async (req, res, next) => {
  try {
    const courseId = req.params.id;
    const section = req.query.section;
    
    // Get class data with department info
    const sql1 = `
      SELECT cl.*, co.name as course_name, co.dept_id 
      FROM class cl 
      JOIN course co ON cl.c_id = co.c_id 
      WHERE cl.c_id = ? AND cl.section = ?`;
    const classData = await queryParamPromise(sql1, [courseId, section]);

    if (!classData || classData.length === 0) {
      req.flash('error_msg', 'Class not found');
      return res.redirect('/staff/add-marks');
    }

    console.log('Class Data:', classData[0]);

    // Get all students in this department and section
    const sql2 = `
      SELECT s.s_id, s.s_name as name, s.email 
      FROM student s
      WHERE s.dept_id = ? 
      AND s.section = ?
      ORDER BY s.s_name`;
    
    const students = await queryParamPromise(sql2, [
      classData[0].dept_id,
      parseInt(section)  // Convert section to integer since it's stored as int in DB
    ]);

    console.log('Found students:', students.length);

    // Get existing marks
    for (let student of students) {
      const sql3 = 'SELECT * FROM marks WHERE s_id = ? AND c_id = ?';
      const marks = await queryParamPromise(sql3, [student.s_id, courseId]);
      if (marks.length > 0) {
        student.internal_marks = marks[0].internal_marks;
        student.external_marks = marks[0].external_marks;
      } else {
        student.internal_marks = 0;
        student.external_marks = 0;
      }
    }

    res.render('Staff/addMarks', {
      page_name: 'marks',
      classData: classData[0],
      students,
      courseId
    });
  } catch (err) {
    console.error('Error in getClassMarks:', err);
    req.flash('error_msg', 'Error loading student marks');
    res.redirect('/staff/add-marks');
  }
};

exports.postClassMarks = async (req, res, next) => {
  try {
    const courseId = req.params.id;
    const { marks } = req.body;

    // Log the received marks data
    console.log('Received marks data:', marks);

    for (const studentId in marks) {
      const internal = marks[studentId].internal === '' ? null : parseInt(marks[studentId].internal);
      const external = marks[studentId].external === '' ? null : parseInt(marks[studentId].external);

      console.log(`Processing marks for student ${studentId}:`, { internal, external });

      // Check if marks already exist
      const existingMarks = await queryParamPromise(
        'SELECT * FROM marks WHERE s_id = ? AND c_id = ?',
        [studentId, courseId]
      );

      console.log('Existing marks:', existingMarks);

      if (existingMarks.length > 0) {
        // Update existing marks
        const updateResult = await queryParamPromise(
          'UPDATE marks SET internal_marks = ?, external_marks = ? WHERE s_id = ? AND c_id = ?',
          [internal, external, studentId, courseId]
        );
        console.log('Update result:', updateResult);
      } else {
        // Insert new marks
        const insertResult = await queryParamPromise(
          'INSERT INTO marks (s_id, c_id, internal_marks, external_marks) VALUES (?, ?, ?, ?)',
          [studentId, courseId, internal, external]
        );
        console.log('Insert result:', insertResult);
      }
    }

    req.flash('success_msg', 'Marks updated successfully');
    res.redirect('/staff/add-marks');
  } catch (err) {
    console.error('Error in postClassMarks:', err);
    req.flash('error_msg', 'Error updating marks');
    res.redirect('/staff/add-marks');
  }
};

exports.downloadClassReport = async (req, res, next) => {
  const courseId = req.params.id;
  const staffId = req.user;
  const section = req.query.section;
  
  try {
    // Get staff data
    const sql1 = 'SELECT * FROM staff WHERE st_id = ?';
    const staffData = await queryParamPromise(sql1, [staffId]);
    
    // Get class data with department info
    const classData = await queryParamPromise(
      'SELECT cl.*, co.name as course_name, co.dept_id FROM class cl JOIN course co ON cl.c_id = co.c_id WHERE cl.c_id = ? AND cl.st_id = ? AND cl.section = ?',
      [courseId, staffId, section]
    );

    if (!classData || classData.length === 0) {
      req.flash('error_msg', 'Class not found');
      return res.redirect('/staff/class-report');
    }

    // Get students in this class
    const students = await queryParamPromise(
      'SELECT s.* FROM student s WHERE s.dept_id = ? AND s.section = ?',
      [classData[0].dept_id, parseInt(section)]
    );

    // Get attendance data for each student
    const attendanceStats = [];
    for (const student of students) {
      const totalClasses = await queryParamPromise(
        'SELECT COUNT(DISTINCT date) as total FROM attendance WHERE c_id = ?',
        [courseId]
      );
      
      const attendedClasses = await queryParamPromise(
        'SELECT COUNT(*) as attended FROM attendance WHERE c_id = ? AND s_id = ? AND status = 1',
        [courseId, student.s_id]
      );

      const percentage = totalClasses[0].total > 0 
        ? ((attendedClasses[0].attended / totalClasses[0].total) * 100).toFixed(2)
        : 0;

      attendanceStats.push({
        s_id: student.s_id,
        name: student.s_name,
        total_classes: totalClasses[0].total,
        attended_classes: attendedClasses[0].attended,
        percentage: percentage
      });
    }

    // Render the PDF template
    res.render('Staff/classReportPDF', {
      user: staffData[0],
      classData: classData[0],
      attendanceStats,
      layout: false
    }, (err, html) => {
      if (err) {
        console.error('Error rendering PDF template:', err);
        req.flash('error_msg', 'Error generating PDF report');
        return res.redirect(`/staff/class-report/${courseId}?section=${section}`);
      }

      // PDF generation options
      const options = {
        format: 'A4',
        border: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px'
        }
      };

      // Generate PDF
      pdf.create(html, options).toBuffer((err, buffer) => {
        if (err) {
          console.error('Error generating PDF:', err);
          req.flash('error_msg', 'Error generating PDF report');
          return res.redirect(`/staff/class-report/${courseId}?section=${section}`);
        }

        // Send the PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=class_report_${courseId}_section_${section}.pdf`);
        res.send(buffer);
      });
    });
  } catch (err) {
    console.error('Error in downloadClassReport:', err);
    req.flash('error_msg', 'Error generating class report');
    res.redirect('/staff/class-report');
  }
};

exports.downloadClassReportExcel = async (req, res, next) => {
  const courseId = req.params.id;
  const staffId = req.user;
  const section = req.query.section;
  
  try {
    // Get class data with department info
    const classData = await queryParamPromise(
      'SELECT cl.*, co.name as course_name, co.dept_id FROM class cl JOIN course co ON cl.c_id = co.c_id WHERE cl.c_id = ? AND cl.st_id = ? AND cl.section = ?',
      [courseId, staffId, section]
    );

    if (!classData || classData.length === 0) {
      req.flash('error_msg', 'Class not found');
      return res.redirect('/staff/class-report');
    }

    // Get staff data
    const sql1 = 'SELECT * FROM staff WHERE st_id = ?';
    const staffData = await queryParamPromise(sql1, [staffId]);

    // Get students in this class
    const students = await queryParamPromise(
      'SELECT s.* FROM student s WHERE s.dept_id = ? AND s.section = ?',
      [classData[0].dept_id, parseInt(section)]
    );

    // Get the current month and year
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const monthName = new Date(currentYear, currentMonth).toLocaleString('default', { month: 'long' });
    
    // Get all dates in the current month where attendance was taken for this course
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    
    const formattedFirstDay = firstDay.toISOString().split('T')[0];
    const formattedLastDay = lastDay.toISOString().split('T')[0];
    
    const attendanceDates = await queryParamPromise(
      'SELECT DISTINCT date FROM attendance WHERE c_id = ? AND date BETWEEN ? AND ? ORDER BY date',
      [courseId, formattedFirstDay, formattedLastDay]
    );

    // Create a new Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Attendance Management System';
    workbook.lastModifiedBy = 'Attendance Management System';
    workbook.created = new Date();
    workbook.modified = new Date();

    // Create a worksheet
    const worksheet = workbook.addWorksheet('Class Attendance');
    
    // Set up header row
    worksheet.mergeCells('A1:G1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'Sahyadri College of Engineering and Management';
    titleCell.font = { size: 14, bold: true };
    titleCell.alignment = { horizontal: 'center' };
    
    worksheet.mergeCells('A2:G2');
    const subtitleCell = worksheet.getCell('A2');
    subtitleCell.value = 'Class Attendance Report';
    subtitleCell.font = { size: 12, bold: true };
    subtitleCell.alignment = { horizontal: 'center' };
    
    // Class info
    worksheet.getCell('A4').value = 'Course:';
    worksheet.getCell('B4').value = `${classData[0].course_name} (${classData[0].c_id})`;
    worksheet.getCell('A5').value = 'Section:';
    worksheet.getCell('B5').value = classData[0].section;
    worksheet.getCell('A6').value = 'Semester:';
    worksheet.getCell('B6').value = classData[0].semester;
    worksheet.getCell('A7').value = 'Staff:';
    worksheet.getCell('B7').value = staffData[0].st_name;
    worksheet.getCell('A8').value = 'Month:';
    worksheet.getCell('B8').value = `${monthName} ${currentYear}`;
    
    // Bold the labels
    ['A4', 'A5', 'A6', 'A7', 'A8'].forEach(cell => {
      worksheet.getCell(cell).font = { bold: true };
    });
    
    // Add a summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    
    // Set up summary sheet header
    summarySheet.mergeCells('A1:F1');
    const summaryTitleCell = summarySheet.getCell('A1');
    summaryTitleCell.value = 'Sahyadri College of Engineering and Management';
    summaryTitleCell.font = { size: 14, bold: true };
    summaryTitleCell.alignment = { horizontal: 'center' };
    
    summarySheet.mergeCells('A2:F2');
    const summarySubtitleCell = summarySheet.getCell('A2');
    summarySubtitleCell.value = 'Class Attendance Summary';
    summarySubtitleCell.font = { size: 12, bold: true };
    summarySubtitleCell.alignment = { horizontal: 'center' };
    
    // Class info in summary sheet
    summarySheet.getCell('A4').value = 'Course:';
    summarySheet.getCell('B4').value = `${classData[0].course_name} (${classData[0].c_id})`;
    summarySheet.getCell('A5').value = 'Section:';
    summarySheet.getCell('B5').value = classData[0].section;
    summarySheet.getCell('A6').value = 'Semester:';
    summarySheet.getCell('B6').value = classData[0].semester;
    summarySheet.getCell('A7').value = 'Staff:';
    summarySheet.getCell('B7').value = staffData[0].st_name;
    summarySheet.getCell('A8').value = 'Month:';
    summarySheet.getCell('B8').value = `${monthName} ${currentYear}`;
    
    // Bold the labels in summary sheet
    ['A4', 'A5', 'A6', 'A7', 'A8'].forEach(cell => {
      summarySheet.getCell(cell).font = { bold: true };
    });
    
    // Add summary table header
    const summaryHeaderRow = summarySheet.addRow(['#', 'Student ID', 'Name', 'Classes Attended', 'Attendance %', 'Status']);
    summaryHeaderRow.font = { bold: true };
    summaryHeaderRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    
    // Add attendance data to summary sheet
    const attendanceStats = [];
    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      
      // Get total classes for this course
      const totalClasses = await queryParamPromise(
        'SELECT COUNT(DISTINCT date) as total FROM attendance WHERE c_id = ? AND date BETWEEN ? AND ?',
        [courseId, formattedFirstDay, formattedLastDay]
      );
      
      // Get attended classes for this student
      const attendedClasses = await queryParamPromise(
        'SELECT COUNT(*) as attended FROM attendance WHERE c_id = ? AND s_id = ? AND status = 1 AND date BETWEEN ? AND ?',
        [courseId, student.s_id, formattedFirstDay, formattedLastDay]
      );
      
      const total = totalClasses[0].total || 0;
      const attended = attendedClasses[0].attended || 0;
      const percentage = total === 0 ? 0 : Math.round((attended / total) * 100);
      
      attendanceStats.push({
        s_id: student.s_id,
        name: student.s_name,
        total_classes: total,
        attended_classes: attended,
        percentage: percentage
      });
      
      // Add row to summary sheet
      const summaryRow = summarySheet.addRow([
        i + 1,
        student.s_id,
        student.s_name,
        `${attended} / ${total}`,
        `${percentage}%`,
        percentage >= 75 ? 'Good Standing' : 'Attendance Shortage'
      ]);
      
      // Style the status cell
      const statusCell = summaryRow.getCell(6);
      if (percentage >= 75) {
        statusCell.font = { color: { argb: '008000' } }; // Green
      } else {
        statusCell.font = { color: { argb: 'FF0000' } }; // Red
      }
      
      // Add borders
      summaryRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    }
    
    // Auto-fit columns in summary sheet
    summarySheet.columns.forEach(column => {
      column.width = 15;
    });
    
    // Create detailed attendance sheet with dates
    // First row: headers with student names
    const headers = ['Date', 'Day'];
    students.forEach(student => {
      headers.push(student.s_name);
    });
    
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    
    // Add a row for each date in the month
    if (attendanceDates.length > 0) {
      for (const dateRecord of attendanceDates) {
        const currentDate = new Date(dateRecord.date);
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayName = currentDate.toLocaleDateString('en-US', { weekday: 'long' });
        
        const rowData = [dateStr, dayName];
        
        // Get attendance for each student on this date
        for (const student of students) {
          const attendanceRecord = await queryParamPromise(
            'SELECT status FROM attendance WHERE c_id = ? AND s_id = ? AND date = ?',
            [courseId, student.s_id, dateStr]
          );
          
          const status = attendanceRecord.length > 0 
            ? (attendanceRecord[0].status === 1 ? 'Present' : 'Absent') 
            : 'N/A';
          
          rowData.push(status);
        }
        
        const row = worksheet.addRow(rowData);
        
        // Style the status cells
        for (let i = 3; i < rowData.length + 1; i++) {
          const cell = row.getCell(i);
          if (rowData[i - 1] === 'Present') {
            cell.font = { color: { argb: '008000' } }; // Green
          } else if (rowData[i - 1] === 'Absent') {
            cell.font = { color: { argb: 'FF0000' } }; // Red
          }
        }
        
        // Add borders
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      }
    } else {
      // If no attendance records found
      worksheet.addRow(['No attendance records found for this period']);
    }
    
    // Auto-fit columns
    worksheet.columns.forEach(column => {
      column.width = 15;
    });
    
    // Set response headers for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=class_report_${courseId}_section_${section}.xlsx`);
    
    // Write to response
    await workbook.xlsx.write(res);
    
  } catch (err) {
    console.error('Error in downloadClassReportExcel:', err);
    req.flash('error_msg', 'Error generating Excel report');
    res.redirect('/staff/class-report');
  }
};

const { sendWhatsAppMessage } = require('../services/whatsapp');

exports.sendAttendanceNotification = async (req, res, next) => {
  try {
    const { courseId, studentIds, section, notificationType } = req.body;
    const staffId = req.user;
    
    // Get staff data
    const staffData = await queryParamPromise(
      'SELECT * FROM staff WHERE st_id = ?', 
      [staffId]
    );
    
    // Get course data
    const courseData = await queryParamPromise(
      'SELECT * FROM course WHERE c_id = ?',
      [courseId]
    );
    
    // If no students selected, redirect back with error
    if (!studentIds || (Array.isArray(studentIds) && studentIds.length === 0)) {
      req.flash('error_msg', 'No students selected');
      return res.redirect(`/staff/class-report/class/${courseId}?section=${section || ''}`);
    }
    
    // Convert to array if single student ID
    const studentsToNotify = Array.isArray(studentIds) ? studentIds : [studentIds];
    
    // Track successful and failed notifications
    let successCount = 0;
    let failCount = 0;
    
    // Process each student
    for (const studentId of studentsToNotify) {
      try {
        // Get student data
        const studentData = await queryParamPromise(
          'SELECT * FROM student WHERE s_id = ?',
          [studentId]
        );
        
        if (!studentData || studentData.length === 0) {
          console.error('Student not found:', studentId);
          failCount++;
          continue;
        }
        
        // Get attendance data
        const totalClasses = await queryParamPromise(
          'SELECT COUNT(DISTINCT date) as total FROM attendance WHERE c_id = ?',
          [courseId]
        );
        
        const attendedClasses = await queryParamPromise(
          'SELECT COUNT(*) as attended FROM attendance WHERE c_id = ? AND s_id = ? AND status = 1',
          [courseId, studentId]
        );
        
        const percentage = totalClasses[0].total > 0 
          ? ((attendedClasses[0].attended / totalClasses[0].total) * 100).toFixed(2)
          : 0;
        
        // Prepare notification message
        const message = `
Attendance Warning: ${courseData[0].name}

Dear ${studentData[0].s_name},

This is to notify you that your attendance in the course ${courseData[0].name} has fallen below the required threshold of 75%.

Current Attendance: ${percentage}% (${attendedClasses[0].attended} out of ${totalClasses[0].total} classes)

Please note that a minimum attendance of 75% is required to be eligible for examinations.

If you have any concerns or require any clarification, please contact your course instructor, ${staffData[0].st_name}.

Regards,
${staffData[0].st_name}
Course Instructor - ${courseData[0].name}
Sahyadri College of Engineering and Management`;

        if (notificationType === 'whatsapp') {
          // Send WhatsApp notification
          try {
            await sendWhatsAppMessage(studentData[0].contact, message);
            console.log('WhatsApp message sent successfully to student:', studentId);
            successCount++;
          } catch (whatsappErr) {
            console.error('Error sending WhatsApp message to student:', studentId, whatsappErr);
            failCount++;
          }
        } else {
          // Send email notification
          const emailData = {
            from: `"Sahyadri College" <${process.env.EMAIL_USER || 'your-email@gmail.com'}>`,
            to: studentData[0].email,
            subject: 'Low Attendance Warning - ' + courseData[0].name,
            html: message.replace(/\n/g, '<br>')
          };
          
          try {
            const result = await transporter.sendMail(emailData);
            console.log('Email sent successfully to student:', studentId, result);
            successCount++;
          } catch (mailErr) {
            console.error('Error sending email to student:', studentId, mailErr);
            failCount++;
          }
        }
        
      } catch (err) {
        console.error('Error processing student notification:', studentId, err);
        failCount++;
      }
    }
    
    // Set flash message and redirect
    const notificationTypeText = notificationType === 'whatsapp' ? 'WhatsApp' : 'Email';
    req.flash('success_msg', `${notificationTypeText} notifications sent to ${successCount} students. ${failCount > 0 ? failCount + ' failed.' : ''}`);
    return res.redirect(`/staff/class-report/class/${courseId}?section=${section || ''}`);
    
  } catch (err) {
    console.error('Error in sendAttendanceNotification:', err);
    req.flash('error_msg', 'Error sending notifications');
    return res.redirect('/staff/class-report');
  }
};

exports.testEmail = async (req, res, next) => {
  try {
    const staffId = req.user;
    
    // Get staff data
    const staffData = await queryParamPromise(
      'SELECT * FROM staff WHERE st_id = ?', 
      [staffId]
    );
    
    if (!staffData || staffData.length === 0) {
      req.flash('error_msg', 'Staff not found');
      return res.redirect('/staff/dashboard');
    }
    
    // Log environment variables (without exposing sensitive info)
    console.log('Email Configuration:');
    console.log('- DOMAIN_NAME configured:', process.env.DOMAIN_NAME ? 'Yes' : 'No');
    console.log('- EMAIL_USER configured:', process.env.EMAIL_USER ? 'Yes' : 'No');
    console.log('- EMAIL_PASSWORD configured:', process.env.EMAIL_PASSWORD ? 'Yes' : 'No');
    
    // Prepare test email data
    const emailData = {
      from: 'Test Email <test@' + DOMAIN + '>',
      to: staffData[0].email,
      subject: 'Test Email from Attendance System',
      html: `
        <h2>Test Email</h2>
        <p>Dear ${staffData[0].st_name},</p>
        <p>This is a test email from the College Management System.</p>
        <p>If you're receiving this, email functionality is working correctly.</p>
        <p>Regards,<br/>
        System Administrator<br/>
        Sahyadri College of Engineering and Management</p>
      `
    };
    
    console.log('Sending test email to:', staffData[0].email);
    
    // Send test email using updated Mailgun client
    try {
      const result = await transporter.sendMail(emailData);
      console.log('Test email sent successfully:', result);
      req.flash('success_msg', 'Test email sent successfully. Please check your inbox.');
      return res.redirect('/staff/dashboard');
    } catch (mailErr) {
      console.error('Error sending test email:', mailErr);
      req.flash('error_msg', `Error sending test email: ${mailErr.message}`);
      return res.redirect('/staff/dashboard');
    }
  } catch (err) {
    console.error('Error in testEmail function:', err);
    req.flash('error_msg', 'Error sending test email');
    return res.redirect('/staff/dashboard');
  }
};
