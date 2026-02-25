// server.js - Backend for Original Hustle Coin (OHC)
// Easy for beginners - everything explained with comments

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));   // serves your HTML + JS

// ====================== DATABASE ======================
const db = new sqlite3.Database('./ohc.db');

db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    wallet TEXT NOT NULL,
    mining_time INTEGER DEFAULT 0,
    referrals INTEGER DEFAULT 0,
    membership_paid REAL DEFAULT 0,
    referral_earnings REAL DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Global settings (early buyers, community supply, dates)
  db.run(`CREATE TABLE IF NOT EXISTS globals (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  const now = new Date().toISOString();
  db.run(`INSERT OR IGNORE INTO globals (key, value) VALUES ('early_remaining', '100000000')`);
  db.run(`INSERT OR IGNORE INTO globals (key, value) VALUES ('community_remaining', '600000000')`);
  db.run(`INSERT OR IGNORE INTO globals (key, value) VALUES ('last_update', '${now}')`);
  db.run(`INSERT OR IGNORE INTO globals (key, value) VALUES ('start_date', '${now}')`);
});

// Helper function for levels (same on frontend)
function getLevel(referrals) {
  if (referrals >= 50) return {name: 'Conqueror', num: 7};
  if (referrals >= 25) return {name: 'Diamond', num: 6};
  if (referrals >= 20) return {name: 'Platinum', num: 5};
  if (referrals >= 15) return {name: 'Gold', num: 4};
  if (referrals >= 10) return {name: 'Silver', num: 3};
  if (referrals >= 5)  return {name: 'Bronze', num: 2};
  return {name: 'Iron', num: 1};
}

// ====================== API ROUTES ======================

// Register
app.post('/api/register', (req, res) => {
  const { username, email, password, wallet, ref } = req.body;

  // Strong password check
  if (!/[A-Z]/.test(password) || (password.match(/\d/g) || []).length < 2 || password.length < 8) {
    return res.status(400).json({ error: 'Password needs 1 uppercase letter, 2 numbers and 8+ characters' });
  }

  bcrypt.hash(password, 10, (err, hashedPass) => {
    if (err) return res.status(500).json({ error: 'Server error' });

    db.run(`INSERT INTO users (username, email, password, wallet, membership_paid) 
            VALUES (?, ?, ?, ?, 300)`, 
      [username, email, hashedPass, wallet], 
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username or email already taken' });
          return res.status(500).json({ error: err.message });
        }

        const userId = this.lastID;

        // Handle referral
        if (ref) {
          db.get('SELECT id FROM users WHERE username = ?', [ref], (err2, row) => {
            if (row) {
              db.run('UPDATE users SET referrals = referrals + 1 WHERE id = ?', [row.id]);
              db.run('UPDATE users SET referral_earnings = referral_earnings + 45 WHERE id = ?', [row.id]); // 15% of 300 KSH
            }
            res.json({ success: true, user: { id: userId, username, email, wallet, mining_time: 0, referrals: 0, membership_paid: 300, referral_earnings: 0 }});
          });
        } else {
          res.json({ success: true, user: { id: userId, username, email, wallet, mining_time: 0, referrals: 0, membership_paid: 300, referral_earnings: 0 }});
        }
      });
  });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Wrong username or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Wrong username or password' });

    delete user.password;
    res.json({ success: true, user });
  });
});

// Update mining time (called every minute)
app.post('/api/update-mining', (req, res) => {
  const { userId, seconds } = req.body;
  db.run('UPDATE users SET mining_time = mining_time + ? WHERE id = ?', [seconds, userId], () => {
    res.json({ success: true });
  });
});

// Get fresh user data
app.get('/api/user/:id', (req, res) => {
  db.get('SELECT id, username, email, wallet, mining_time, referrals, membership_paid, referral_earnings FROM users WHERE id = ?', 
    [req.params.id], (err, user) => {
      res.json(user);
    });
});

// Globals (early buyers + community supply + daily subtraction)
app.get('/api/globals', (req, res) => {
  db.all('SELECT * FROM globals', (err, rows) => {
    let g = {};
    rows.forEach(r => g[r.key] = r.value);

    const last = new Date(g.last_update);
    const now = new Date();
    const days = Math.floor((now - last) / (86400000));

    if (days > 0) {
      let early = parseFloat(g.early_remaining);
      let comm = parseFloat(g.community_remaining);
      early = Math.max(0, early - days * 2000000);
      comm = Math.max(0, comm - days * 3500000);

      db.run('UPDATE globals SET value = ? WHERE key = ?', [early.toString(), 'early_remaining']);
      db.run('UPDATE globals SET value = ? WHERE key = ?', [comm.toString(), 'community_remaining']);
      db.run('UPDATE globals SET value = ? WHERE key = ?', [now.toISOString(), 'last_update']);

      g.early_remaining = early.toString();
      g.community_remaining = comm.toString();
      g.last_update = now.toISOString();
    }
    res.json(g);
  });
});

// Buy early coins
app.post('/api/buy-early', (req, res) => {
  const { kshAmount } = req.body;
  const coins = parseFloat(kshAmount);

  db.get('SELECT value FROM globals WHERE key = "early_remaining"', (err, row) => {
    let rem = parseFloat(row.value);
    if (coins > rem) return res.status(400).json({ error: 'Not enough coins left' });

    const newRem = rem - coins;
    db.run('UPDATE globals SET value = ? WHERE key = "early_remaining"', [newRem.toString()]);
    res.json({ success: true, bought: coins, remaining: newRem });
  });
});

// Claim after 6 months
app.post('/api/claim', (req, res) => {
  const { userId } = req.body;
  db.get('SELECT mining_time, referrals FROM users WHERE id = ?', [userId], (err, user) => {
    db.get('SELECT value FROM globals WHERE key = "start_date"', (err2, sRow) => {
      const start = new Date(sRow.value);
      const lockEnd = new Date(start.getTime() + 183 * 86400000); // ~6 months

      if (new Date() < lockEnd) {
        return res.status(400).json({ error: '6-month lock not finished yet!' });
      }

      const level = getLevel(user.referrals);
      const hours = user.mining_time / 3600;
      const reward = Math.floor(hours * 100 + user.referrals * 2000 + level.num * 10000);

      res.json({ success: true, claimed: reward, message: `🎉 You claimed ${reward} OHC coins!` });
    });
  });
});

// Easy view database
app.get('/api/admin/users', (req, res) => {
  db.all('SELECT * FROM users', (err, rows) => res.json(rows));
});
// ====================== LEVEL UPGRADE API ======================

// Get required fee for next level
app.get('/api/next-level-fee/:userId', (req, res) => {
  db.get('SELECT referrals, membership_paid FROM users WHERE id = ?', [req.params.userId], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'User not found' });

    const current = getLevel(row.referrals);
    let nextFee = 0;

    switch (current.num) {
      case 1: nextFee = 500; break;   // to Bronze
      case 2: nextFee = 1000; break;
      case 3: nextFee = 2000; break;
      case 4: nextFee = 5000; break;
      case 5: nextFee = 7500; break;
      case 6: nextFee = 10000; break;
      default: nextFee = 0; // already max
    }

    res.json({
      currentLevel: current.name,
      currentFeePaid: row.membership_paid,
      nextLevelFeeKSH: nextFee,
      canUpgrade: nextFee > 0 && row.membership_paid < nextFee
    });
  });
});

// Confirm upgrade (called after user sends TON tx)
app.post('/api/upgrade-level', (req, res) => {
  const { userId, paidKSH } = req.body;

  db.get('SELECT membership_paid FROM users WHERE id = ?', [userId], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'User not found' });

    const newPaid = row.membership_paid + paidKSH;

    db.run('UPDATE users SET membership_paid = ? WHERE id = ?', [newPaid, userId], () => {
      res.json({ success: true, newPaid });
    });
  });
});
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 OHC App running on port ${process.env.PORT || 3000}`);
});