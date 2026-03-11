// server.js - Backend for Original Hustle Coin (OHC)
// Easy for beginners - everything explained with comments

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = 3000;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "CHANGE_THIS_SECRET";
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_JWT_SECRET";

if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN === 'CHANGE_THIS_SECRET') {
  console.warn('WARNING: ADMIN_TOKEN is not securely configured.');
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'CHANGE_THIS_JWT_SECRET') {
  console.warn('WARNING: JWT_SECRET is not securely configured.');
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];

  if (token !== ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  next();
}

// NEW: Auth Middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // contains id, username
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// NEW: Token Generator
function signUserToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ====================== SUPPLY REDUCTION CONSTANTS ======================
// Daily supply deduction amounts (hidden from frontend)
const EARLY_DAILY_SUB = parseInt(process.env.EARLY_DAILY_SUB || 2000000);
const COMM_DAILY_SUB = parseInt(process.env.COMM_DAILY_SUB || 3500000);

app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token']
}));
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
    bought_coins REAL DEFAULT 0,
    referrer_id INTEGER DEFAULT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ohc_balance REAL DEFAULT 0,
    purchased_ohc REAL DEFAULT 0,
    reward_ohc REAL DEFAULT 0
  )`);

  // Ensure bought_coins column exists (for older databases)
  db.run(`ALTER TABLE users ADD COLUMN bought_coins REAL DEFAULT 0`, (err) => {
    if (err && !err.message.includes("duplicate column")) {
      console.error("Error adding bought_coins column:", err.message);
    }
  });

  // Ensure referrer_id column exists (for older databases)
  db.run(`ALTER TABLE users ADD COLUMN referrer_id INTEGER DEFAULT NULL`, (err) => {
    if (err && !err.message.includes("duplicate column")) {
      console.error("Error adding referrer_id column:", err.message);
    }
  });

  // Ensure ohc_balance column exists (for older databases)
db.run(`ALTER TABLE users ADD COLUMN ohc_balance REAL DEFAULT 0`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("Error adding ohc_balance column:", err.message);
  }
});

// Ensure purchased_ohc column exists (for older databases)
db.run(`ALTER TABLE users ADD COLUMN purchased_ohc REAL DEFAULT 0`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("Error adding purchased_ohc column:", err.message);
  }
});

// Ensure reward_ohc column exists (for older databases)
db.run(`ALTER TABLE users ADD COLUMN reward_ohc REAL DEFAULT 0`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("Error adding reward_ohc column:", err.message);
  }
});

db.run(`ALTER TABLE users ADD COLUMN referral_reward_given INTEGER DEFAULT 0`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("Error adding referral_reward_given column:", err.message);
  }
});

db.run(`ALTER TABLE users ADD COLUMN telegram_username TEXT`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("Error adding telegram_username:", err.message);
  }
});

db.run(`ALTER TABLE users ADD COLUMN telegram_verified INTEGER DEFAULT 0`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("Error adding telegram_verified:", err.message);
  }
});

db.run(`ALTER TABLE users ADD COLUMN telegram_rewarded INTEGER DEFAULT 0`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("Error adding telegram_rewarded:", err.message);
  }
});

db.run(`ALTER TABLE users ADD COLUMN telegram_verification_code TEXT`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("Error adding telegram_verification_code:", err.message);
  }
});

db.run(`ALTER TABLE users ADD COLUMN claim_status TEXT DEFAULT 'locked'`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("Error adding claim_status:", err.message);
  }
});

db.run(`ALTER TABLE users ADD COLUMN claimed_at DATETIME DEFAULT NULL`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("Error adding claimed_at:", err.message);
  }
});

db.run(`ALTER TABLE users ADD COLUMN claimed_ohc REAL DEFAULT 0`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("Error adding claimed_ohc:", err.message);
  }
});

  // Global settings (early buyers, community supply, dates)
  db.run(`CREATE TABLE IF NOT EXISTS globals (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Wallet ledger - every wallet change is recorded here
  db.run(`CREATE TABLE IF NOT EXISTS wallet_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    entry_type TEXT NOT NULL,
    source_ref TEXT DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Public activity feed table
  db.run(`CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    activity_type TEXT NOT NULL,
    public_text TEXT NOT NULL,
    amount REAL DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

const LEVELS = [
  { num: 1, name: 'Iron', fee: 300 },
  { num: 2, name: 'Bronze', fee: 500 },
  { num: 3, name: 'Silver', fee: 1000 },
  { num: 4, name: 'Gold', fee: 2000 },
  { num: 5, name: 'Platinum', fee: 5000 },
  { num: 6, name: 'Diamond', fee: 7500 },
  { num: 7, name: 'Conqueror', fee: 10000 }
];

const MEMBERSHIP_LEVELS = LEVELS;

function getLevelByFee(fee) {
  return LEVELS.find(level => level.fee === fee) || null;
}

function calculateLevelWalletCredit(levelFee) {
  return levelFee * 1.5;
}

function getMembershipLevelByPaid(paidAmount) {
  let currentLevel = { num: 0, name: 'Not Activated', fee: 0 };

  for (const level of MEMBERSHIP_LEVELS) {
    if (paidAmount >= level.fee) {
      currentLevel = level;
    }
  }

  return currentLevel;
}

function getNextMembershipLevel(paidAmount) {
  return MEMBERSHIP_LEVELS.find(level => level.fee > paidAmount) || null;
}

// NEW: Helper function to write ledger entries
function addWalletLedgerEntry({ userId, amount, entryType, sourceRef = null, notes = null }, callback) {
  db.run(
    `INSERT INTO wallet_ledger (user_id, amount, entry_type, source_ref, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, amount, entryType, sourceRef, notes],
    function(err) {
      if (callback) callback(err, this);
    }
  );
}

// NEW: Reward referrer ONLY after first real payment
function rewardReferrerIfEligible(paidUserId, callback) {
  db.get(
    `SELECT referrer_id, referral_reward_given FROM users WHERE id = ?`,
    [paidUserId],
    (err, paidUser) => {
      if (err) return callback(err);
      if (!paidUser) return callback(new Error('Paid user not found'));

      if (!paidUser.referrer_id) {
        return callback(null, { rewarded: false, reason: 'No referrer' });
      }

      if (paidUser.referral_reward_given) {
        return callback(null, { rewarded: false, reason: 'Already rewarded' });
      }

      const referrerId = paidUser.referrer_id;
      const rewardAmount = 30; // 30 OHC Reward

      db.get(
        `SELECT referrals, ohc_balance, reward_ohc FROM users WHERE id = ?`,
        [referrerId],
        (err2, referrer) => {
          if (err2) return callback(err2);
          if (!referrer) return callback(new Error('Referrer not found'));

          const newReferrals = (referrer.referrals || 0) + 1;
          const newWallet = (referrer.ohc_balance || 0) + rewardAmount;
          const newRewardOHC = (referrer.reward_ohc || 0) + rewardAmount;

          db.run(
            `UPDATE users SET referrals = ?, ohc_balance = ?, reward_ohc = ? WHERE id = ?`,
            [newReferrals, newWallet, newRewardOHC, referrerId],
            function(updateErr) {
              if (updateErr) return callback(updateErr);

              db.run(
                `UPDATE users SET referral_reward_given = 1 WHERE id = ?`,
                [paidUserId],
                function(flagErr) {
                  if (flagErr) return callback(flagErr);

                  addWalletLedgerEntry(
                    {
                      userId: referrerId,
                      amount: rewardAmount,
                      entryType: 'referral_reward',
                      sourceRef: `referred_user_${paidUserId}`,
                      notes: `Referral reward for user ${paidUserId} first successful payment`
                    },
                    (ledgerErr) => {
                      if (ledgerErr) return callback(ledgerErr);

                      db.get('SELECT username FROM users WHERE id = ?', [referrerId], (nameErr, refUser) => {
                        if (!nameErr && refUser) {
                          addActivity(
                            {
                              userId: referrerId,
                              activityType: 'referral_reward',
                              publicText: `${refUser.username} earned 30 OHC from a referral`,
                              amount: rewardAmount
                            },
                            () => {
                              callback(null, {
                                rewarded: true,
                                referrerId,
                                rewardAmount
                              });
                            }
                          );
                        } else {
                          callback(null, {
                            rewarded: true,
                            referrerId,
                            rewardAmount
                          });
                        }
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
}

function generateTelegramCode(userId) {
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `OHC-${userId}-${randomPart}`;
}

// NEW: Helper function to log public activity
function addActivity({ userId = null, activityType, publicText, amount = null }, callback) {
  db.run(
    `INSERT INTO activities (user_id, activity_type, public_text, amount)
     VALUES (?, ?, ?, ?)`,
    [userId, activityType, publicText, amount],
    function(err) {
      if (callback) callback(err, this);
    }
  );
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

    // If ref provided, find the referrer's ID first
    let referrerId = null;
    
    const insertUser = () => {
      db.run(`INSERT INTO users (username, email, password, wallet, membership_paid, referrer_id) 
              VALUES (?, ?, ?, ?, 0, ?)`, 
        [username, email, hashedPass, wallet, referrerId], 
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username or email already taken' });
            return res.status(500).json({ error: err.message });
          }

          const userId = this.lastID;

          // Create the safe user object
          const safeUser = {
            id: userId,
            username,
            email,
            wallet,
            mining_time: 0,
            referrals: 0,
            membership_paid: 0,
            referral_earnings: 0,
            bought_coins: 0,
            ohc_balance: 0,
            purchased_ohc: 0,
            reward_ohc: 0,
            claim_status: 'locked',
            claimed_at: null,
            claimed_ohc: 0,
            referrer_id: referrerId
          };

          // Generate JWT token (assuming you have a signUserToken function available)
          const token = signUserToken({ id: userId, username });

          // Send response with token and user data
          res.json({
            success: true,
            token,
            user: safeUser
          });
        });
    };

    // If ref code provided, lookup referrer first
    if (ref) {
      db.get('SELECT id FROM users WHERE username = ?', [ref], (err2, row) => {
        if (row) {
          referrerId = row.id;
        }
        insertUser();
      });
    } else {
      insertUser();
    }
  });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Wrong username or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Wrong username or password' });

    // Create token
    const token = signUserToken({ id: user.id, username: user.username });
    
    // Remove password from user object before sending
    delete user.password;
    
    // Send response with token and all user fields
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        wallet: user.wallet,
        mining_time: user.mining_time,
        referrals: user.referrals,
        membership_paid: user.membership_paid,
        referral_earnings: user.referral_earnings,
        bought_coins: user.bought_coins,
        ohc_balance: user.ohc_balance,
        purchased_ohc: user.purchased_ohc,
        reward_ohc: user.reward_ohc,
        claim_status: user.claim_status,
        claimed_at: user.claimed_at,
        claimed_ohc: user.claimed_ohc,
        telegram_username: user.telegram_username,
        telegram_verified: user.telegram_verified,
        telegram_rewarded: user.telegram_rewarded
      }
    });
  });
});

// Get current user data (protected route)
app.get('/api/me', requireAuth, (req, res) => {
  db.get(
    `SELECT
      id,
      username,
      email,
      wallet,
      mining_time,
      referrals,
      membership_paid,
      referral_earnings,
      bought_coins,
      ohc_balance,
      purchased_ohc,
      reward_ohc,
      referrer_id,
      joined_at,
      claim_status,
      claimed_at,
      claimed_ohc,
      telegram_username,
      telegram_verified,
      telegram_rewarded
     FROM users
     WHERE id = ?`,
    [req.user.id],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    }
  );
});

// Update mining time (called every minute)
app.post('/api/update-mining', requireAuth, (req, res) => {
  const userId = req.user.id;
  const { seconds } = req.body;

  if (!seconds) {
    return res.status(400).json({ error: 'Missing seconds' });
  }

  db.get('SELECT membership_paid FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (row.membership_paid < 300) {
      return res.status(403).json({
        error: 'Mining locked until 300 KSH activation payment'
      });
    }

    db.run(
      'UPDATE users SET mining_time = mining_time + ? WHERE id = ?',
      [seconds, userId],
      (updateErr) => {
        if (updateErr) {
          return res.status(500).json({ error: updateErr.message });
        }
        res.json({ success: true });
      }
    );
  });
});

// Beacon endpoint for saving mining time when tab closes
app.post('/api/update-mining-beacon', requireAuth, (req, res) => {
  const userId = req.user.id;
  const { seconds } = req.body || {};

  if (!seconds) {
    return res.status(204).send();
  }

  db.get('SELECT membership_paid FROM users WHERE id = ?', [userId], (err, row) => {
    if (err || !row || row.membership_paid < 300) {
      return res.status(204).send();
    }

    db.run(
      'UPDATE users SET mining_time = mining_time + ? WHERE id = ?',
      [seconds, userId],
      () => {
        res.status(204).send();
      }
    );
  });
});

// Get fresh user data
app.get('/api/user/:id', requireAdmin, (req, res) => {
  db.get(
    `SELECT
      id,
      username,
      email,
      wallet,
      mining_time,
      referrals,
      membership_paid,
      referral_earnings,
      bought_coins,
      ohc_balance,
      purchased_ohc,
      reward_ohc,
      referrer_id,
      joined_at,
      claim_status,
      claimed_at,
      claimed_ohc,
      telegram_username,
      telegram_verified,
      telegram_rewarded
     FROM users
     WHERE id = ?`,
    [req.params.id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json(user);
    }
  );
});

// Get referrals for the logged-in user securely
app.get('/api/referrals', requireAuth, (req, res) => {
  db.all(
    'SELECT username, joined_at FROM users WHERE referrer_id = ? ORDER BY joined_at DESC',
    [req.user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.json(rows || []);
    }
  );
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
      early = Math.max(0, early - days * EARLY_DAILY_SUB);
      comm = Math.max(0, comm - days * COMM_DAILY_SUB);

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

// Confirm early buy after TON transaction
app.post('/api/confirm-buy', requireAuth, (req, res) => {
  const body = req.body || {};

  const userId = req.user.id;
  const kshAmount = body.kshAmount;
  const txHash = body.txHash;

  if (!kshAmount) {
    return res.status(400).json({ error: 'Missing kshAmount' });
  }

  const coins = parseFloat(kshAmount);
  if (isNaN(coins) || coins <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  db.get(
    `SELECT bought_coins, ohc_balance, purchased_ohc
     FROM users
     WHERE id = ?`,
    [userId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'User not found' });

      const newBought = (row.bought_coins || 0) + coins;
      const newWallet = (row.ohc_balance || 0) + coins;
      const newPurchased = (row.purchased_ohc || 0) + coins;

      db.run(
        `UPDATE users
         SET bought_coins = ?, ohc_balance = ?, purchased_ohc = ?
         WHERE id = ?`,
        [newBought, newWallet, newPurchased, userId],
        function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: updateErr.message });
          }

          addWalletLedgerEntry(
            {
              userId,
              amount: coins,
              entryType: 'early_buy',
              sourceRef: txHash || null,
              notes: `Bought OHC worth ${coins} KSH`
            },
            (ledgerErr) => {
              if (ledgerErr) {
                return res.status(500).json({ error: ledgerErr.message });
              }

              db.get('SELECT username FROM users WHERE id = ?', [userId], (nameErr, userRow) => {
                if (!nameErr && userRow) {
                  addActivity(
                    {
                      userId,
                      activityType: 'early_buy',
                      publicText: `${userRow.username} bought ${coins.toLocaleString()} OHC`,
                      amount: coins
                    },
                    () => {
                      console.log('Purchase TX:', txHash || 'no hash');
                      res.json({
                        success: true,
                        newBought: newBought,
                        ohc_balance: newWallet,
                        purchased_ohc: newPurchased
                      });
                    }
                  );
                } else {
                  console.log('Purchase TX:', txHash || 'no hash');
                  res.json({
                    success: true,
                    newBought: newBought,
                    ohc_balance: newWallet,
                    purchased_ohc: newPurchased
                  });
                }
              });
            }
          );
        }
      );
    }
  );
});

// Claim after 6 months
app.post('/api/claim', requireAuth, (req, res) => {
  const userId = req.user.id;

  db.get(
    `SELECT id, username, mining_time, referrals, ohc_balance, reward_ohc, claim_status, claimed_at
     FROM users
     WHERE id = ?`,
    [userId],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.claim_status === 'claimed') {
        return res.status(400).json({ error: 'You have already claimed your OHC reward.' });
      }

      db.get(
        `SELECT value FROM globals WHERE key = "start_date"`,
        [],
        (err2, sRow) => {
          if (err2 || !sRow) {
            return res.status(500).json({ error: 'Could not read claim lock date' });
          }

          const start = new Date(sRow.value);
          const lockEnd = new Date(start.getTime() + 183 * 86400000);

          if (new Date() < lockEnd) {
            return res.status(400).json({ error: '6-month lock not finished yet!' });
          }

          const level = getLevel(user.referrals);
          const hours = (user.mining_time || 0) / 3600;
          const reward = Math.floor(hours * 100 + (user.referrals || 0) * 2000 + level.num * 10000);

          const newWallet = (user.ohc_balance || 0) + reward;
          const newRewardOHC = (user.reward_ohc || 0) + reward;
          const now = new Date().toISOString();

          db.run(
            `UPDATE users
             SET ohc_balance = ?,
                 reward_ohc = ?,
                 claim_status = 'claimed',
                 claimed_at = ?,
                 claimed_ohc = ?
             WHERE id = ?`,
            [newWallet, newRewardOHC, now, reward, userId],
            function(updateErr) {
              if (updateErr) return res.status(500).json({ error: updateErr.message });

              addWalletLedgerEntry(
                {
                  userId,
                  amount: reward,
                  entryType: 'claim',
                  sourceRef: '6_month_claim',
                  notes: `6-month claim reward for ${user.username}`
                },
                (ledgerErr) => {
                  if (ledgerErr) return res.status(500).json({ error: ledgerErr.message });

                  addActivity(
                    {
                      userId,
                      activityType: 'claim',
                      publicText: `${user.username} claimed ${reward.toLocaleString()} OHC`,
                      amount: reward
                    },
                    (activityErr) => {
                      if (activityErr) return res.status(500).json({ error: activityErr.message });

                      res.json({
                        success: true,
                        claimed: reward,
                        ohc_balance: newWallet,
                        reward_ohc: newRewardOHC,
                        claim_status: 'claimed',
                        claimed_at: now,
                        claimed_ohc: reward,
                        message: `You claimed ${reward.toLocaleString()} OHC!`
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
});

// Easy view database (admin protected)
app.get('/api/admin/users', requireAdmin, (req, res) => {
  db.all(
    'SELECT id, username, email, wallet, membership_paid, referrals, referral_earnings FROM users',
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json(rows);
    }
  );
});
// ====================== LEVEL UPGRADE API ======================

// Get next level fee and dynamic labels for logged-in user
app.get('/api/next-level-fee', requireAuth, (req, res) => {
  db.get(
    'SELECT membership_paid, referrals FROM users WHERE id = ?',
    [req.user.id],
    (err, row) => {
      if (err || !row) {
        return res.status(404).json({ error: 'User not found' });
      }

      const paid = row.membership_paid || 0;

      const currentMembership = getMembershipLevelByPaid(paid);
      const nextMembership = getNextMembershipLevel(paid);
      const referralRank = getLevel(row.referrals);

      res.json({
        currentFeePaid: paid,
        currentMembershipLevelNumber: currentMembership.num,
        currentMembershipLevelName: currentMembership.name,
        nextLevelNumber: nextMembership ? nextMembership.num : null,
        nextLevelName: nextMembership ? nextMembership.name : null,
        nextLevelFeeKSH: nextMembership ? nextMembership.fee : 0,
        canUpgrade: !!nextMembership,
        referralRankName: referralRank.name,
        referralRankNumber: referralRank.num
      });
    }
  );
});

// Upgrade level
app.post('/api/upgrade-level', requireAuth, (req, res) => {
  const userId = req.user.id;
  const { paidKSH, txHash } = req.body;

  if (paidKSH == null) {
    return res.status(400).json({ error: 'Missing amount' });
  }

  const amount = parseFloat(paidKSH);
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid payment amount' });
  }

  const targetLevel = getLevelByFee(amount);

  if (!targetLevel) {
    return res.status(400).json({ error: 'Invalid level fee selected' });
  }

  db.get(
    `SELECT membership_paid, ohc_balance, reward_ohc
     FROM users
     WHERE id = ?`,
    [userId],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const currentPaid = user.membership_paid || 0;

      if (currentPaid >= targetLevel.fee) {
        return res.status(400).json({ error: 'You already reached this level or higher' });
      }

      const walletCredit = calculateLevelWalletCredit(targetLevel.fee);
      const newWallet = (user.ohc_balance || 0) + walletCredit;
      const newRewardOHC = (user.reward_ohc || 0) + walletCredit;

      db.run(
        `UPDATE users
         SET membership_paid = ?, ohc_balance = ?, reward_ohc = ?
         WHERE id = ?`,
        [targetLevel.fee, newWallet, newRewardOHC, userId],
        function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'Failed to update level and wallet' });
          }

          addWalletLedgerEntry(
            {
              userId,
              amount: walletCredit,
              entryType: 'level_reward',
              sourceRef: txHash || `level_${targetLevel.num}`,
              notes: `${targetLevel.name} level payment of ${targetLevel.fee} KSH credited ${walletCredit} OHC (includes 50% bonus)`
            },
            (ledgerErr) => {
              if (ledgerErr) {
                return res.status(500).json({ error: ledgerErr.message });
              }

              rewardReferrerIfEligible(userId, (refErr, refResult) => {
                if (refErr) {
                  return res.status(500).json({ error: refErr.message });
                }

                db.get('SELECT username FROM users WHERE id = ?', [userId], (nameErr, userRow) => {
                  const finishResponse = () => {
                    res.json({
                      success: true,
                      message: `Level upgraded to ${targetLevel.name}. ${walletCredit} OHC added to wallet.`,
                      membership_paid: targetLevel.fee,
                      ohc_balance: newWallet,
                      reward_ohc: newRewardOHC,
                      credited_ohc: walletCredit,
                      level: targetLevel,
                      referralRewardTriggered: refResult?.rewarded || false
                    });
                  };

                  if (!nameErr && userRow) {
                    addActivity(
                      {
                        userId,
                        activityType: 'level_upgrade',
                        publicText: `${userRow.username} upgraded to ${targetLevel.name}`,
                        amount: targetLevel.fee
                      },
                      () => finishResponse()
                    );
                  } else {
                    finishResponse();
                  }
                });
              });
            }
          );
        }
      );
    }
  );
});

// Secure Change Password
app.post('/api/change-password', requireAuth, (req, res) => {
  const userId = req.user.id;
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Old password and new password are required' });
  }

  if (!/[A-Z]/.test(newPassword) || (newPassword.match(/\d/g) || []).length < 2 || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password needs 1 uppercase, 2 numbers, 8+ characters' });
  }

  db.get('SELECT password FROM users WHERE id = ?', [userId], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'User not found' });

    bcrypt.compare(oldPassword, row.password, (compareErr, ok) => {
      if (compareErr) return res.status(500).json({ error: 'Server error' });
      if (!ok) return res.status(400).json({ error: 'Old password is incorrect' });

      bcrypt.hash(newPassword, 10, (hashErr, hashedPass) => {
        if (hashErr) return res.status(500).json({ error: 'Server error' });

        db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPass, userId], function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'Error updating password' });
          }
          res.json({ success: true, message: 'Password updated successfully' });
        });
      });
    });
  });
});

// ====================== TELEGRAM REWARD API ======================

// Start Verification: Generate code and save username
app.post('/api/telegram/start', requireAuth, (req, res) => {
  const userId = req.user.id;
  const { telegramUsername } = req.body;

  if (!telegramUsername) {
    return res.status(400).json({ error: 'Missing telegramUsername' });
  }

  const code = generateTelegramCode(userId);

  db.run(
    `UPDATE users SET telegram_username = ?, telegram_verification_code = ? WHERE id = ?`,
    [telegramUsername, code, userId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Telegram verification started', code });
    }
  );
});

// Complete Verification: Give 20 OHC if verified
app.post('/api/telegram/complete', requireAuth, (req, res) => {
  const userId = req.user.id;

  db.get(
    `SELECT ohc_balance, reward_ohc, telegram_verified, telegram_rewarded FROM users WHERE id = ?`,
    [userId],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (!user.telegram_verified) {
        return res.status(400).json({ error: 'Telegram membership not verified yet' });
      }

      if (user.telegram_rewarded) {
        return res.status(400).json({ error: 'Telegram reward already claimed' });
      }

      const rewardAmount = 20;
      const newWallet = (user.ohc_balance || 0) + rewardAmount;
      const newRewardOHC = (user.reward_ohc || 0) + rewardAmount;

      db.run(
        `UPDATE users SET ohc_balance = ?, reward_ohc = ?, telegram_rewarded = 1 WHERE id = ?`,
        [newWallet, newRewardOHC, userId],
        function(updateErr) {
          if (updateErr) return res.status(500).json({ error: updateErr.message });

          addWalletLedgerEntry(
            {
              userId,
              amount: rewardAmount,
              entryType: 'telegram_reward',
              sourceRef: 'telegram_group_join',
              notes: 'Telegram group verification reward'
            },
            (ledgerErr) => {
              if (ledgerErr) return res.status(500).json({ error: ledgerErr.message });

              db.get('SELECT username FROM users WHERE id = ?', [userId], (nameErr, userRow) => {
                if (!nameErr && userRow) {
                  addActivity(
                    {
                      userId,
                      activityType: 'telegram_reward',
                      publicText: `${userRow.username} earned 20 OHC from Telegram verification`,
                      amount: rewardAmount
                    },
                    () => {
                      res.json({
                        success: true,
                        message: `Telegram verified! ${rewardAmount} OHC added to wallet.`,
                        ohc_balance: newWallet,
                        reward_ohc: newRewardOHC
                      });
                    }
                  );
                } else {
                  res.json({
                    success: true,
                    message: `Telegram verified! ${rewardAmount} OHC added to wallet.`,
                    ohc_balance: newWallet,
                    reward_ohc: newRewardOHC
                  });
                }
              });
            }
          );
        }
      );
    }
  );
});

// TEMPORARY ADMIN ROUTE: Manually mark a user as verified (until bot is built)
app.post('/api/telegram/mark-verified', (req, res) => {
  const { userId, code } = req.body;

  if (!userId || !code) return res.status(400).json({ error: 'Missing userId or code' });

  db.get(
    `SELECT telegram_verification_code FROM users WHERE id = ?`,
    [userId],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (user.telegram_verification_code !== code) {
        return res.status(400).json({ error: 'Invalid verification code' });
      }

      db.run(`UPDATE users SET telegram_verified = 1 WHERE id = ?`, [userId], function(updateErr) {
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        res.json({ success: true, message: 'Telegram marked as verified' });
      });
    }
  );
});

// ====================== ACTIVITY FEED API ======================

app.get('/api/activity-feed', (req, res) => {
  db.all(
    `SELECT id, user_id, activity_type, public_text, amount, created_at
     FROM activities
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 30`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

app.get('/api/activity-summary/today', (req, res) => {
  db.all(
    `SELECT activity_type, COUNT(*) as count, COALESCE(SUM(amount), 0) as total_amount
     FROM activities
     WHERE date(created_at) = date('now')
     GROUP BY activity_type`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      let summary = {
        upgradesToday: 0,
        earlyBuysToday: 0,
        referralRewardsToday: 0,
        telegramRewardsToday: 0,
        ohcBoughtToday: 0
      };

      rows.forEach(row => {
        if (row.activity_type === 'level_upgrade') summary.upgradesToday = row.count;
        if (row.activity_type === 'early_buy') {
          summary.earlyBuysToday = row.count;
          summary.ohcBoughtToday = row.total_amount;
        }
        if (row.activity_type === 'referral_reward') summary.referralRewardsToday = row.count;
        if (row.activity_type === 'telegram_reward') summary.telegramRewardsToday = row.count;
      });

      res.json(summary);
    }
  );
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 OHC App running on port ${process.env.PORT || 3000}`);
});