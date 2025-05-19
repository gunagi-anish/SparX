const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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

exports.getLogin = (req, res, next) => {
  res.render('Student/login');
};

exports.postLogin = (req, res, next) => {
  try {
    const { email, password } = req.body;
    let errors = [];

    if (!email || !password) {
      errors.push({ msg: 'Please enter all fields' });
      return res.status(400).render('Student/login', { errors });
    }

    let sql5 = 'SELECT * FROM student WHERE email = ?';
    db.query(sql5, [email], async (err, results) => {
      if (
        results.length === 0 ||
        !(await bcrypt.compare(password, results[0].password))
      ) {
        errors.push({ msg: 'Email or Password is Incorrect' });
        res.status(401).render('Student/login', { errors });
      } else {
        const user = results[0];
        const token = jwt.sign({ id: user.s_id }, process.env.JWT_SECRET, {
          expiresIn: process.env.JWT_EXPIRE,
        });

        res.cookie('jwt', token, {
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000,
        });
        res.redirect('/student/dashboard');
      }
    });
  } catch (err) {
    throw err;
  }
};

exports.getDashboard = async (req, res, next) => {
  try {
    // Get student data
    const sql1 = 'SELECT * FROM student WHERE s_id = ?';
    const studentData = await queryParamPromise(sql1, [req.user]);
    
    if (!studentData || studentData.length === 0) {
      return res.redirect('/student/login');
    }

    // Calculate current semester
    const days = (await queryParamPromise('select datediff(current_date(), ?) as diff', [studentData[0].joining_date]))[0].diff;
    let semester = Math.min(Math.floor(days / 182) + 1, 8);

    // Get courses for current semester
    let sql2 = 'SELECT * from course WHERE dept_id = ? AND semester = ? LIMIT 3';
    let courseData = await queryParamPromise(sql2, [studentData[0].dept_id, semester]);

    // Fallback to highest semester with courses if current semester has no courses
    if (courseData.length === 0) {
      const sqlMaxSem = 'SELECT MAX(semester) as maxSem FROM course WHERE dept_id = ?';
      const maxSemResult = await queryParamPromise(sqlMaxSem, [studentData[0].dept_id]);
      if (maxSemResult[0].maxSem) {
        semester = maxSemResult[0].maxSem;
        courseData = await queryParamPromise(sql2, [studentData[0].dept_id, semester]);
      }
    }

    // Get attendance data for each course - UPDATED to match Excel report logic
    let courseAttendance = [];
    for (let course of courseData) {
      // Get all classes for the course (regardless of student attendance)
      const totalClassesQuery = `
        SELECT COUNT(DISTINCT date) as total 
        FROM attendance 
        WHERE c_id = ?`;
      const totalClassesResult = await queryParamPromise(totalClassesQuery, [course.c_id]);
      
      // Get only the classes the student attended
      const attendedClassesQuery = `
        SELECT COUNT(*) as attended 
        FROM attendance 
        WHERE c_id = ? AND s_id = ? AND status = 1`;
      const attendedClassesResult = await queryParamPromise(attendedClassesQuery, [course.c_id, req.user]);
      
      const total = totalClassesResult[0].total || 0;
      const attended = attendedClassesResult[0].attended || 0;
      const percentage = total === 0 ? 0 : Math.round((attended / total) * 100);

      courseAttendance.push({
        courseId: course.c_id,
        courseName: course.name,
        totalClasses: total,
        attendedClasses: attended,
        percentage: percentage
      });
    }

    res.render('Student/dashboard', {
      name: studentData[0].s_name,
      page_name: 'overview',
      courseAttendance: courseAttendance
    });
  } catch (err) {
    console.error('Error in getDashboard:', err);
    res.redirect('/student/login');
  }
};

exports.getProfile = async (req, res, next) => {
  const sql = 'SELECT * FROM student WHERE s_id = ?';
  const sql2 =
    'SELECT d_name FROM department WHERE dept_id = (SELECT dept_id FROM student WHERE s_id = ?)';

  const profileData = await queryParamPromise(sql, [req.user]);
  const deptName = await queryParamPromise(sql2, [req.user]);

  const dobs = new Date(profileData[0].dob);
  const jd = new Date(profileData[0].joining_date);

  let dob =
    dobs.getDate() + '/' + (dobs.getMonth() + 1) + '/' + dobs.getFullYear();
  let jds = jd.getDate() + '/' + (jd.getMonth() + 1) + '/' + jd.getFullYear();

  return res.render('Student/profile', {
    data: profileData,
    page_name: 'profile',
    dname: deptName[0].d_name,
    dob,
    jds,
  });
};

exports.getSelectAttendance = async (req, res, next) => {
  try {
    // Get student data to determine current semester
    const sql1 = 'SELECT * FROM student WHERE s_id = ?';
    const studentData = (await queryParamPromise(sql1, [req.user]))[0];

    if (!studentData) {
      req.flash('error_msg', 'Student data not found');
      return res.redirect('/student/dashboard');
    }

    // Calculate current semester based on joining date
    const days = (await queryParamPromise('select datediff(current_date(), ?) as diff', [studentData.joining_date]))[0].diff;
    let currentSemester = Math.min(Math.floor(days / 182) + 1, 8); // Cap at 8 semesters

    // Get courses for current semester
    let sql2 = `
      SELECT c.*, d.d_name 
      FROM course c 
      JOIN department d ON c.dept_id = d.dept_id 
      WHERE c.dept_id = ? 
      AND c.semester = ?
    `;
    let courseData = await queryParamPromise(sql2, [studentData.dept_id, currentSemester]);

    // If no courses for calculated semester, fallback to highest semester with courses
    if (courseData.length === 0) {
      const sqlMaxSem = `SELECT MAX(semester) as maxSem FROM course WHERE dept_id = ?`;
      const maxSemResult = await queryParamPromise(sqlMaxSem, [studentData.dept_id]);
      if (maxSemResult[0].maxSem) {
        currentSemester = maxSemResult[0].maxSem;
        courseData = await queryParamPromise(sql2, [studentData.dept_id, currentSemester]);
      }
    }

    // Get current year
    const currentYear = new Date().getFullYear();

    // Check if there's any attendance data for this student
    const sql3 = `
      SELECT COUNT(*) as count 
      FROM attendance a
      JOIN course c ON a.c_id = c.c_id
      WHERE a.s_id = ? 
      AND c.dept_id = ?
    `;
    const attendanceCount = await queryParamPromise(sql3, [req.user, studentData.dept_id]);

    res.render('Student/selectAttendance', {
      page_name: 'attendance',
      curYear: currentYear,
      currentSemester: currentSemester,
      studentData: studentData,
      hasAttendance: attendanceCount[0].count > 0,
      hasCourses: courseData.length > 0,
      courseData: courseData // Pass course data to the view
    });
  } catch (err) {
    console.error('Error in getSelectAttendance:', err);
    req.flash('error_msg', 'Error loading attendance page');
    res.redirect('/student/dashboard');
  }
};

const getAttendanceData = async (year, courseData, s_id) => {
  let monthDates = [];
  let isPresent = [];
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'April', 'May', 'June',
    'July', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  try {
    const courseIds = courseData.map(course => course.c_id);

    // Get all months with attendance for this student and year
    const sql = `
      SELECT DISTINCT MONTH(date) as month
      FROM attendance
      WHERE c_id IN (?) AND s_id = ? AND YEAR(date) = ?
      ORDER BY month
    `;
    const existingMonths = await queryParamPromise(sql, [courseIds, s_id, year]);
    const relevantMonths = existingMonths.map(row => row.month - 1); // JS months are 0-based

    // If no months found, show the current month
    if (relevantMonths.length === 0 && year === new Date().getFullYear()) {
      relevantMonths.push(new Date().getMonth());
    }

    for (const month of relevantMonths) {
      let dayNumber = 1;
      let date = new Date(year, month, dayNumber);
      let days = [];
      let outerStatus = [];
      
      // Process all days in the month
      while (date.getMonth() === month) {
        let status = [];
        const sqlDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;

        // Get attendance for all courses on this date
        const sql3 = `
          SELECT c_id, status 
          FROM attendance 
          WHERE c_id IN (?) 
          AND s_id = ? 
          AND date = ?
        `;
        const attendanceData = await queryParamPromise(sql3, [courseIds, s_id, sqlDate]);
        
        // Create a map of course_id to status
        const attendanceMap = {};
        attendanceData.forEach(record => {
          // Ensure status is explicitly 0 or 1
          attendanceMap[record.c_id] = record.status === null ? 0 : Number(record.status);
        });
        
        // Add status for each course
        for (const course of courseData) {
          if (attendanceMap[course.c_id] !== undefined) {
            status.push({ status: attendanceMap[course.c_id] });
          } else {
            status.push({ status: undefined }); // No attendance record for this date/course
          }
        }
        
        outerStatus.push(status);
        const monthName = monthNames[month];
        days.push({ monthName, dayNumber });
        
        dayNumber++;
        date.setDate(date.getDate() + 1);
      }
      
      isPresent.push(outerStatus);
      monthDates.push(days);
    }
    
    return [monthDates, isPresent];
  } catch (err) {
    console.error('Error in getAttendanceData:', err);
    throw err;
  }
};

exports.postSelectAttendance = async (req, res, next) => {
  try {
    const { year, semester } = req.body;
    const sql1 = 'SELECT * FROM student WHERE s_id = ?';
    const studentData = (await queryParamPromise(sql1, [req.user]))[0];
    if (!studentData) {
      req.flash('error_msg', 'Student data not found');
      return res.redirect('/student/dashboard');
    }
    const sql2 = 'SELECT * from course WHERE dept_id = ? AND semester = ?';
    const courseData = await queryParamPromise(sql2, [studentData.dept_id, semester]);
    if (courseData.length === 0) {
      req.flash('error_msg', 'No courses found for the selected semester');
      return res.redirect('/student/selectAttendance');
    }
    // Only show months with attendance
    const [monthDates, isPresent] = await getAttendanceData(
      parseInt(year),
      courseData,
      req.user
    );
    if (monthDates.length === 0) {
      req.flash('error_msg', 'No attendance records found for the selected period');
      return res.redirect('/student/selectAttendance');
    }
    res.render('Student/attendance', {
      page_name: 'attendance',
      curSemester: semester,
      studentData,
      courseData,
      monthDates,
      isPresent,
    });
  } catch (err) {
    console.error('Error in postSelectAttendance:', err);
    req.flash('error_msg', 'Error loading attendance data');
    res.redirect('/student/selectAttendance');
  }
};

exports.getLogout = (req, res, next) => {
  res.cookie('jwt', '', { maxAge: 1 });
  req.flash('success_msg', 'You are logged out');
  res.redirect('/student/login');
};

// FORGOT PASSWORD
exports.getForgotPassword = (req, res, next) => {
  res.render('Student/forgotPassword');
};

exports.forgotPassword = async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).render('Student/forgotPassword');
  }

  let errors = [];

  const sql1 = 'SELECT * FROM student WHERE email = ?';
  const results = await queryParamPromise(sql1, [email]);
  if (!results || results.length === 0) {
    errors.push({ msg: 'That email is not registered!' });
    return res.status(401).render('Student/forgotPassword', {
      errors,
    });
  }

  const token = jwt.sign(
    { _id: results[0].s_id },
    process.env.RESET_PASSWORD_KEY,
    { expiresIn: '20m' }
  );

  const data = {
    from: 'noreplyCMS@mail.com',
    to: email,
    subject: 'Reset Password Link',
    html: `<h2>Please click on given link to reset your password</h2>
                <p><a href="${process.env.URL}/student/resetpassword/${token}">Reset Password</a></p>
                <hr>
                <p><b>The link will expire in 20m!</b></p>
              `,
  };

  const sql2 = 'UPDATE student SET resetLink = ? WHERE email = ?';
  db.query(sql2, [token, email], (err, success) => {
    if (err) {
      errors.push({ msg: 'Error In ResetLink' });
      res.render('Student/forgotPassword', { errors });
    } else {
      transporter.sendMail(data, (err, info) => {
        if (err) {
          errors.push({ msg: 'Error sending email' });
          res.render('Student/forgotPassword', { errors });
        } else {
          req.flash('success_msg', 'Reset Link Sent Successfully!');
          res.redirect('/student/forgot-password');
        }
      });
    }
  });
};

exports.getResetPassword = (req, res, next) => {
  const resetLink = req.params.id;
  res.render('Student/resetPassword', { resetLink });
};

exports.resetPassword = (req, res, next) => {
  const { resetLink, password, confirmPass } = req.body;

  let errors = [];

  if (password !== confirmPass) {
    req.flash('error_msg', 'Passwords do not match!');
    res.redirect(`/student/resetpassword/${resetLink}`);
  } else {
    if (resetLink) {
      jwt.verify(resetLink, process.env.RESET_PASSWORD_KEY, (err, data) => {
        if (err) {
          errors.push({ msg: 'Token Expired!' });
          res.render('Student/resetPassword', { errors });
        } else {
          const sql1 = 'SELECT * FROM student WHERE resetLink = ?';
          db.query(sql1, [resetLink], async (err, results) => {
            if (err || results.length === 0) {
              throw err;
            } else {
              let hashed = await bcrypt.hash(password, 8);

              const sql2 =
                'UPDATE student SET password = ? WHERE resetLink = ?';
              db.query(sql2, [hashed, resetLink], (errorData, retData) => {
                if (errorData) {
                  throw errorData;
                } else {
                  req.flash(
                    'success_msg',
                    'Password Changed Successfully! Login Now'
                  );
                  res.redirect('/student/login');
                }
              });
            }
          });
        }
      });
    } else {
      errors.push({ msg: 'Authentication Error' });
      res.render('Student/resetPassword', { errors });
    }
  }
};

exports.getAttendanceReport = async (req, res, next) => {
  try {
    // Get student data
    const sql1 = 'SELECT * FROM student WHERE s_id = ?';
    const studentData = (await queryParamPromise(sql1, [req.user]))[0];

    // Calculate current semester
    const days = (await queryParamPromise('select datediff(current_date(), ?) as diff', [studentData.joining_date]))[0].diff;
    let semester = Math.min(Math.floor(days / 182) + 1, 8);

    // Get courses for current semester
    let sql2 = 'SELECT * from course WHERE dept_id = ? AND semester = ?';
    let courseData = await queryParamPromise(sql2, [studentData.dept_id, semester]);

    // Fallback to highest semester with courses
    if (courseData.length === 0) {
      const sqlMaxSem = 'SELECT MAX(semester) as maxSem FROM course WHERE dept_id = ?';
      const maxSemResult = await queryParamPromise(sqlMaxSem, [studentData.dept_id]);
      if (maxSemResult[0].maxSem) {
        semester = maxSemResult[0].maxSem;
        courseData = await queryParamPromise(sql2, [studentData.dept_id, semester]);
      }
    }

    // Get attendance data for each course - UPDATED to match Excel report logic
    let attendanceStats = [];
    for (let course of courseData) {
      // Get all classes for the course (regardless of student attendance)
      const totalClassesQuery = `
        SELECT COUNT(DISTINCT date) as total 
        FROM attendance 
        WHERE c_id = ?`;
      const totalClassesResult = await queryParamPromise(totalClassesQuery, [course.c_id]);
      
      // Get only the classes the student attended
      const attendedClassesQuery = `
        SELECT COUNT(*) as attended 
        FROM attendance 
        WHERE c_id = ? AND s_id = ? AND status = 1`;
      const attendedClassesResult = await queryParamPromise(attendedClassesQuery, [course.c_id, req.user]);
      
      const total = totalClassesResult[0].total || 0;
      const attended = attendedClassesResult[0].attended || 0;
      const percentage = total === 0 ? 0 : Math.round((attended / total) * 100);

      attendanceStats.push({
        courseId: course.c_id,
        courseName: course.name,
        totalClasses: total,
        attendedClasses: attended,
        percentage: percentage
      });
    }

    res.render('Student/attendanceReport', {
      page_name: 'attendance',
      studentData,
      semester,
      attendanceStats
    });
  } catch (err) {
    console.error('Error in getAttendanceReport:', err);
    req.flash('error_msg', 'Error generating attendance report');
    res.redirect('/student/dashboard');
  }
};

const pdf = require('html-pdf');
const path = require('path');
const ExcelJS = require('exceljs');

exports.downloadAttendanceReport = async (req, res, next) => {
  try {
    // Get student data
    const sql1 = 'SELECT * FROM student WHERE s_id = ?';
    const studentData = (await queryParamPromise(sql1, [req.user]))[0];

    // Calculate current semester
    const days = (await queryParamPromise('select datediff(current_date(), ?) as diff', [studentData.joining_date]))[0].diff;
    let semester = Math.min(Math.floor(days / 182) + 1, 8);

    // Get courses for current semester
    let sql2 = 'SELECT * from course WHERE dept_id = ? AND semester = ?';
    let courseData = await queryParamPromise(sql2, [studentData.dept_id, semester]);

    // Fallback to highest semester with courses
    if (courseData.length === 0) {
      const sqlMaxSem = 'SELECT MAX(semester) as maxSem FROM course WHERE dept_id = ?';
      const maxSemResult = await queryParamPromise(sqlMaxSem, [studentData.dept_id]);
      if (maxSemResult[0].maxSem) {
        semester = maxSemResult[0].maxSem;
        courseData = await queryParamPromise(sql2, [studentData.dept_id, semester]);
      }
    }

    // Get attendance data for each course - UPDATED to match Excel report logic
    let attendanceStats = [];
    for (let course of courseData) {
      // Get all classes for the course (regardless of student attendance)
      const totalClassesQuery = `
        SELECT COUNT(DISTINCT date) as total 
        FROM attendance 
        WHERE c_id = ?`;
      const totalClassesResult = await queryParamPromise(totalClassesQuery, [course.c_id]);
      
      // Get only the classes the student attended
      const attendedClassesQuery = `
        SELECT COUNT(*) as attended 
        FROM attendance 
        WHERE c_id = ? AND s_id = ? AND status = 1`;
      const attendedClassesResult = await queryParamPromise(attendedClassesQuery, [course.c_id, req.user]);
      
      const total = totalClassesResult[0].total || 0;
      const attended = attendedClassesResult[0].attended || 0;
      const percentage = total === 0 ? 0 : Math.round((attended / total) * 100);

      attendanceStats.push({
        courseId: course.c_id,
        courseName: course.name,
        totalClasses: total,
        attendedClasses: attended,
        percentage: percentage
      });
    }

    res.render('Student/attendanceReportPDF', {
      studentData,
      semester,
      attendanceStats,
      layout: false
    }, (err, html) => {
      if (err) {
        console.error('Error rendering PDF template:', err);
        req.flash('error_msg', 'Error generating PDF report');
        return res.redirect('/student/attendance-report');
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
          return res.redirect('/student/attendance-report');
        }

        // Send the PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${studentData.s_name.replace(/\s+/g, '_')}.pdf`);
        res.send(buffer);
      });
    });

  } catch (err) {
    console.error('Error in downloadAttendanceReport:', err);
    req.flash('error_msg', 'Error generating attendance report');
    res.redirect('/student/attendance-report');
  }
};

exports.downloadAttendanceExcel = async (req, res, next) => {
  try {
    // Get student data
    const sql1 = 'SELECT * FROM student WHERE s_id = ?';
    const studentData = (await queryParamPromise(sql1, [req.user]))[0];

    // Calculate current semester
    const days = (await queryParamPromise('select datediff(current_date(), ?) as diff', [studentData.joining_date]))[0].diff;
    let semester = Math.min(Math.floor(days / 182) + 1, 8);

    // Get courses for current semester
    let sql2 = 'SELECT * from course WHERE dept_id = ? AND semester = ?';
    let courseData = await queryParamPromise(sql2, [studentData.dept_id, semester]);

    // Fallback to highest semester with courses
    if (courseData.length === 0) {
      const sqlMaxSem = 'SELECT MAX(semester) as maxSem FROM course WHERE dept_id = ?';
      const maxSemResult = await queryParamPromise(sqlMaxSem, [studentData.dept_id]);
      if (maxSemResult[0].maxSem) {
        semester = maxSemResult[0].maxSem;
        courseData = await queryParamPromise(sql2, [studentData.dept_id, semester]);
      }
    }

    // Create a new Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Attendance Management System';
    workbook.lastModifiedBy = 'Attendance Management System';
    workbook.created = new Date();
    workbook.modified = new Date();

    // Get the current month and year
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const monthName = new Date(currentYear, currentMonth).toLocaleString('default', { month: 'long' });
    
    // Create a worksheet for each course
    for (let course of courseData) {
      const worksheet = workbook.addWorksheet(`${course.c_id}`);
      
      // Set up header row
      worksheet.mergeCells('A1:D1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = 'Sahyadri College of Engineering and Management';
      titleCell.font = { size: 14, bold: true };
      titleCell.alignment = { horizontal: 'center' };
      
      worksheet.mergeCells('A2:D2');
      const subtitleCell = worksheet.getCell('A2');
      subtitleCell.value = 'Student Attendance Report';
      subtitleCell.font = { size: 12, bold: true };
      subtitleCell.alignment = { horizontal: 'center' };
      
      // Student info
      worksheet.getCell('A4').value = 'Name:';
      worksheet.getCell('B4').value = studentData.s_name;
      worksheet.getCell('A5').value = 'Student ID:';
      worksheet.getCell('B5').value = studentData.s_id;
      worksheet.getCell('A6').value = 'Semester:';
      worksheet.getCell('B6').value = semester;
      worksheet.getCell('A7').value = 'Department:';
      worksheet.getCell('B7').value = studentData.dept_id;
      worksheet.getCell('A8').value = 'Course:';
      worksheet.getCell('B8').value = `${course.name} (${course.c_id})`;
      worksheet.getCell('A9').value = 'Month:';
      worksheet.getCell('B9').value = `${monthName} ${currentYear}`;
      
      // Bold the labels
      ['A4', 'A5', 'A6', 'A7', 'A8', 'A9'].forEach(cell => {
        worksheet.getCell(cell).font = { bold: true };
      });
      
      // Get all dates in the current month where attendance was taken for this course
      const firstDay = new Date(currentYear, currentMonth, 1);
      const lastDay = new Date(currentYear, currentMonth + 1, 0);
      
      const formattedFirstDay = firstDay.toISOString().split('T')[0];
      const formattedLastDay = lastDay.toISOString().split('T')[0];
      
      const attendanceDates = await queryParamPromise(
        'SELECT DISTINCT date FROM attendance WHERE c_id = ? AND date BETWEEN ? AND ? ORDER BY date',
        [course.c_id, formattedFirstDay, formattedLastDay]
      );
      
      // Get attendance status for each date
      const attendanceData = await queryParamPromise(
        'SELECT date, status FROM attendance WHERE c_id = ? AND s_id = ? AND date BETWEEN ? AND ?',
        [course.c_id, req.user, formattedFirstDay, formattedLastDay]
      );
      
      // Create a map for quick lookup
      const attendanceMap = new Map();
      attendanceData.forEach(record => {
        const dateStr = new Date(record.date).toISOString().split('T')[0];
        attendanceMap.set(dateStr, record.status);
      });
      
      // Add attendance table header
      const headerRow = worksheet.addRow(['Date', 'Day', 'Status']);
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
      
      // Add a row for each day in the month
      let currentDate = new Date(firstDay);
      while (currentDate <= lastDay) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayName = currentDate.toLocaleDateString('en-US', { weekday: 'long' });
        
        const status = attendanceMap.has(dateStr) 
          ? (attendanceMap.get(dateStr) === 1 ? 'Present' : 'Absent') 
          : 'N/A';
        
        const row = worksheet.addRow([
          dateStr,
          dayName,
          status
        ]);
        
        // Style the status cell
        const statusCell = row.getCell(3);
        if (status === 'Present') {
          statusCell.font = { color: { argb: '008000' } }; // Green
        } else if (status === 'Absent') {
          statusCell.font = { color: { argb: 'FF0000' } }; // Red
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
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      // Add summary at the bottom
      const totalClasses = await queryParamPromise(
        'SELECT COUNT(DISTINCT date) as total FROM attendance WHERE c_id = ? AND date BETWEEN ? AND ?',
        [course.c_id, formattedFirstDay, formattedLastDay]
      );
      
      const attendedClasses = await queryParamPromise(
        'SELECT COUNT(*) as attended FROM attendance WHERE c_id = ? AND s_id = ? AND status = 1 AND date BETWEEN ? AND ?',
        [course.c_id, req.user, formattedFirstDay, formattedLastDay]
      );
      
      const total = totalClasses[0].total || 0;
      const attended = attendedClasses[0].attended || 0;
      const percentage = total === 0 ? 0 : Math.round((attended / total) * 100);
      
      worksheet.addRow([]);
      const summaryRow1 = worksheet.addRow(['Total Classes', total]);
      const summaryRow2 = worksheet.addRow(['Classes Attended', attended]);
      const summaryRow3 = worksheet.addRow(['Attendance Percentage', `${percentage}%`]);
      
      [summaryRow1, summaryRow2, summaryRow3].forEach(row => {
        row.getCell(1).font = { bold: true };
        if (row === summaryRow3) {
          const percentageCell = row.getCell(2);
          if (percentage >= 75) {
            percentageCell.font = { color: { argb: '008000' }, bold: true }; // Green
          } else {
            percentageCell.font = { color: { argb: 'FF0000' }, bold: true }; // Red
          }
        }
      });
      
      // Auto-fit columns
      worksheet.columns.forEach(column => {
        column.width = 15;
      });
    }
    
    // Set response headers for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${studentData.s_name.replace(/\s+/g, '_')}.xlsx`);
    
    // Write to response
    await workbook.xlsx.write(res);
    
  } catch (err) {
    console.error('Error in downloadAttendanceExcel:', err);
    req.flash('error_msg', 'Error generating Excel report');
    res.redirect('/student/attendance-report');
  }
};

// API endpoint for attendance summary on dashboard
exports.getAttendanceSummary = async (req, res, next) => {
  try {
    // Get student data
    const sql1 = 'SELECT * FROM student WHERE s_id = ?';
    const studentData = (await queryParamPromise(sql1, [req.user]))[0];

    // Calculate current semester
    const days = (await queryParamPromise('select datediff(current_date(), ?) as diff', [studentData.joining_date]))[0].diff;
    let semester = Math.min(Math.floor(days / 182) + 1, 8);

    // Get courses for current semester
    let sql2 = 'SELECT * from course WHERE dept_id = ? AND semester = ?';
    let courseData = await queryParamPromise(sql2, [studentData.dept_id, semester]);

    // Fallback to highest semester with courses
    if (courseData.length === 0) {
      const sqlMaxSem = 'SELECT MAX(semester) as maxSem FROM course WHERE dept_id = ?';
      const maxSemResult = await queryParamPromise(sqlMaxSem, [studentData.dept_id]);
      if (maxSemResult[0].maxSem) {
        semester = maxSemResult[0].maxSem;
        courseData = await queryParamPromise(sql2, [studentData.dept_id, semester]);
      }
    }

    // Get attendance data for each course - UPDATED to match Excel report logic
    let courses = [];
    for (let course of courseData) {
      // Get all classes for the course (regardless of student attendance)
      const totalClassesQuery = `
        SELECT COUNT(DISTINCT date) as total 
        FROM attendance 
        WHERE c_id = ?`;
      const totalClassesResult = await queryParamPromise(totalClassesQuery, [course.c_id]);
      
      // Get only the classes the student attended
      const attendedClassesQuery = `
        SELECT COUNT(*) as attended 
        FROM attendance 
        WHERE c_id = ? AND s_id = ? AND status = 1`;
      const attendedClassesResult = await queryParamPromise(attendedClassesQuery, [course.c_id, req.user]);
      
      const total = totalClassesResult[0].total || 0;
      const attended = attendedClassesResult[0].attended || 0;
      const percentage = total === 0 ? 0 : Math.round((attended / total) * 100);

      courses.push({
        courseId: course.c_id,
        courseName: course.name,
        totalClasses: total,
        attendedClasses: attended,
        percentage: percentage
      });
    }

    // Return JSON response
    res.json({
      success: true,
      courses: courses
    });
  } catch (err) {
    console.error('Error in getAttendanceSummary:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching attendance data'
    });
  }
};