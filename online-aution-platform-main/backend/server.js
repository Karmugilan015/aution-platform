const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// ================= CONFIG =================
const PORT = 5001;

// ⚠️ Use ENV in production
const SECRET_KEY = process.env.JWT_SECRET || 'dev_secret_key';

// MongoDB connection
const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb+srv://karmugilan:YOUR_DB_PASSWORD@cluster0.i1155u3.mongodb.net/auctionDB?retryWrites=true&w=majority';

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ================= SCHEMAS =================

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});

const User = mongoose.model('User', userSchema);

// Auction Item Schema
const auctionItemSchema = new mongoose.Schema({
  itemName: { type: String, required: true },
  description: { type: String, required: true },
  currentBid: { type: Number, required: true },
  highestBidder: { type: String, default: '' },
  closingTime: { type: Date, required: true },
  isClosed: { type: Boolean, default: false },
});

const AuctionItem = mongoose.model('AuctionItem', auctionItemSchema);

// ================= AUTH MIDDLEWARE =================

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader)
    return res.status(401).json({ message: 'Unauthorized' });

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : authHeader;

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err)
      return res.status(403).json({ message: 'Invalid token' });

    req.user = decoded;
    next();
  });
};

// ================= ROUTES =================

// 🔹 Signup
app.post('/signup', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ message: 'All fields required' });

    const existingUser = await User.findOne({ username });
    if (existingUser)
      return res.status(400).json({ message: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      password: hashedPassword,
    });

    await user.save();
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
