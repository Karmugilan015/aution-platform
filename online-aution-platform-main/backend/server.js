require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// ================= MIDDLEWARE =================
app.use(express.json());
app.use(cors());

// ================= CONFIG =================
const PORT = process.env.PORT || 5001;
const SECRET_KEY = process.env.JWT_SECRET;

if (!SECRET_KEY) {
  throw new Error('❌ JWT_SECRET missing in environment variables');
}

// ================= MONGODB =================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);
  });

// ================= SCHEMAS =================

// User Schema
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);

// Auction Item Schema
const auctionItemSchema = new mongoose.Schema(
  {
    itemName: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    currentBid: { type: Number, required: true, min: 0 },
    highestBidder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    closingTime: { type: Date, required: true },
    isClosed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const AuctionItem = mongoose.model('AuctionItem', auctionItemSchema);

// ================= AUTH MIDDLEWARE =================
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader)
    return res.status(401).json({ message: 'Authorization header missing' });

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : authHeader;

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

// ================= ROUTES =================

// 🔹 Signup
app.post('/signup', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ message: 'All fields required' });

    const exists = await User.findOne({ username });
    if (exists)
      return res.status(409).json({ message: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({ username, password: hashedPassword });

    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 🔹 Signin
app.post('/signin', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user)
      return res.status(401).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      SECRET_KEY,
      { expiresIn: '1h' }
    );

    res.json({ message: 'Signin successful', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 🔹 Create Auction (Protected)
app.post('/auction', authenticate, async (req, res) => {
  try {
    const { itemName, description, startingBid, closingTime } = req.body;

    if (!itemName || !description || startingBid == null || !closingTime)
      return res.status(400).json({ message: 'All fields required' });

    const auction = await AuctionItem.create({
      itemName,
      description,
      currentBid: startingBid,
      closingTime,
    });

    res.status(201).json({ message: 'Auction created', auction });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 🔹 Get all auctions
app.get('/auctions', async (req, res) => {
  try {
    const auctions = await AuctionItem.find().populate(
      'highestBidder',
      'username'
    );
    res.json(auctions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 🔹 Place Bid (Protected)
app.post('/bid/:id', authenticate, async (req, res) => {
  try {
    const { bid } = req.body;
    const item = await AuctionItem.findById(req.params.id);

    if (!item)
      return res.status(404).json({ message: 'Item not found' });

    if (item.isClosed)
      return res.status(400).json({ message: 'Auction already closed' });

    if (new Date() > item.closingTime) {
      item.isClosed = true;
      await item.save();
      return res.json({ message: 'Auction closed' });
    }

    if (bid <= item.currentBid)
      return res.status(400).json({ message: 'Bid must be higher' });

    item.currentBid = bid;
    item.highestBidder = req.user.userId;
    await item.save();

    res.json({ message: 'Bid successful', item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ================= SERVER =================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
    const user = await User.findOne({ username });
    if (!user)
      return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      SECRET_KEY,
      { expiresIn: '1h' }
    );

    res.json({ message: 'Signin successful', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 🔹 Create Auction (Protected)
app.post('/auction', authenticate, async (req, res) => {
  try {
    const { itemName, description, startingBid, closingTime } = req.body;

    if (!itemName || !description || startingBid == null || !closingTime)
      return res.status(400).json({ message: 'All fields required' });

    const auction = new AuctionItem({
      itemName,
      description,
      currentBid: startingBid,
      closingTime,
    });

    await auction.save();
    res.status(201).json({ message: 'Auction created', auction });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 🔹 Get all auctions
app.get('/auctions', async (req, res) => {
  try {
    const auctions = await AuctionItem.find();
    res.json(auctions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 🔹 Get single auction
app.get('/auctions/:id', async (req, res) => {
  try {
    const auction = await AuctionItem.findById(req.params.id);
    if (!auction)
      return res.status(404).json({ message: 'Auction not found' });

    res.json(auction);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 🔹 Place Bid (Protected)
app.post('/bid/:id', authenticate, async (req, res) => {
  try {
    const { bid } = req.body;
    const item = await AuctionItem.findById(req.params.id);

    if (!item)
      return res.status(404).json({ message: 'Item not found' });

    if (item.isClosed)
      return res.status(400).json({ message: 'Auction closed' });

    if (new Date() > item.closingTime) {
      item.isClosed = true;
      await item.save();
      return res.json({
        message: 'Auction closed',
        winner: item.highestBidder,
      });
    }

    if (bid <= item.currentBid)
      return res.status(400).json({ message: 'Bid too low' });

    item.currentBid = bid;
    item.highestBidder = req.user.username;
    await item.save();

    res.json({ message: 'Bid successful', item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ================= SERVER =================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
