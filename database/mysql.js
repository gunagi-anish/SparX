const mysql = require('mysql2');

module.exports = class Mysql {
  static connect() {
    // establish connection
    const db = mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'cumsdbms',
    });
    // connect to database
    db.connect((err) => {
      if (err) {
        throw err;
      }
      console.log('Mysql Connected');
    });
    return db;
  }
};
