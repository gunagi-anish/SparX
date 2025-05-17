const mysql = require('mysql');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pdf = require('html-pdf');

const mailgun = require('mailgun-js');
const DOMAIN = process.env.DOMAIN_NAME;
const mg = mailgun({ apiKey: process.env.MAILGUN_API_KEY, domain: DOMAIN });

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
  const { date, courseId, ...students } = req.body;
  let attedData = await queryParamPromise(
    'SELECT * FROM attendance WHERE date = ? AND c_id = ?',
    [date, courseId]
  );

  if (attedData.length === 0) {
    for (const s_id in students) {
      const isPresent = students[s_id];
      await queryParamPromise('insert into attendance set ?', {
        s_id: s_id,
        date: date,
        c_id: courseId,
        status: isPresent == 'True' ? 1 : 0,
      });
    }
    req.flash('success_msg', 'Attendance done successfully');
    return res.redirect('/staff/student-attendance');
  }

  for (const s_id in students) {
    const isPresent = students[s_id] === 'True' ? 1 : 0;
    await queryParamPromise(
      'update attendance set status = ? WHERE s_id = ? AND date = ? AND c_id = ?',
      [isPresent, s_id, date, courseId]
    );
  }

  req.flash('success_msg', 'Attendance updated successfully');
  return res.redirect('/staff/student-attendance');
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
    from: 'noreplyCMS@mail.com',
    to: email,
    subject: 'Reset Password Link',
    html: `<h2>Please click on given link to reset your password</h2>
                <p><a href="${process.env.URL}/staff/resetpassword/${token}">Reset Password</a></p>
                <hr>
                <p><b>The link will expire in 20m!</b></p>
              `,
  };

  const sql2 = 'UPDATE staff SET resetLink = ? WHERE email = ?';
  db.query(sql2, [token, email], (err, success) => {
    if (err) {
      errors.push({ msg: 'Error In ResetLink' });
      res.render('Staff/forgotPassword', { errors });
    } else {
      mg.messages().send(data, (err, body) => {
        if (err) throw err;
        else {
          req.flash('success_msg', 'Reset Link Sent Successfully!');
          res.redirect('/staff/forgot-password');
        }
      });
    }
  });
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
