const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Environment variables - Render will provide these
const SECRET_KEY = process.env.SECRET_KEY || 'my_super_secret_123!';
const PORT = process.env.PORT || 5001;
const MONGODB_URI = process.env.MONGODB_URI;

// MongoDB Atlas connection
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB Atlas connected successfully'))
.catch((err) => {
  console.error('MongoDB connection error:', err);
  process.exit(1); // Exit if MongoDB connection fails
});

// Connection events
mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to MongoDB Atlas');
});

mongoose.connection.on('error', (err) => {
  console.log('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected from MongoDB Atlas');
});

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});

const User = mongoose.model('User', userSchema);

// Auction Item Schema
const auctionItemSchema = new mongoose.Schema({
  itemName: String,
  description: String,
  currentBid: Number,
  highestBidder: String,
  closingTime: Date,
  isClosed: { type: Boolean, default: false },
  startingBid: Number, // Added for better tracking
  createdAt: { type: Date, default: Date.now },
});

const AuctionItem = mongoose.model('AuctionItem', auctionItemSchema);

// Middleware to verify token
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid Token' });
    req.user = user;
    next();
  });
};

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Signup Route - Fixed password hashing
app.post('/signup', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }

    const existingUser = await User.findOne({ username });  
    if (existingUser) {  
      return res.status(400).json({ message: 'Username already exists' });  
    }  

    // Hash password before saving
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const newUser = new User({ 
      username, 
      password: hashedPassword 
    });  
    await newUser.save();

    res.status(201).json({ message: 'User registered successfully' });

  } catch (error) {
    console.error('Signup Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Signin Route - Fixed password comparison
app.post('/signin', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Compare hashed password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ 
      userId: user._id, 
      username: user.username 
    }, SECRET_KEY, { 
      expiresIn: '1h' 
    });
    
    res.json({ 
      message: 'Signin successful', 
      token,
      user: {
        id: user._id,
        username: user.username
      }
    });

  } catch (error) {
    console.error('Signin Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Create Auction Item (Protected)
app.post('/auction', authenticate, async (req, res) => {
  try {
    const { itemName, description, startingBid, closingTime } = req.body;

    if (!itemName || !description || !startingBid || !closingTime) {  
      return res.status(400).json({ message: 'All fields are required' });  
    }  

    const newItem = new AuctionItem({  
      itemName,  
      description,  
      currentBid: startingBid,
      startingBid: startingBid, // Store starting bid separately
      highestBidder: '',  
      closingTime,  
    });  

    await newItem.save();  
    res.status(201).json({ 
      message: 'Auction item created', 
      item: newItem 
    });

  } catch (error) {
    console.error('Auction Post Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Get all auction items with optional filtering
app.get('/auctions', async (req, res) => {
  try {
    const { status } = req.query;
    let query = {};
    
    if (status === 'active') {
      query = { isClosed: false, closingTime: { $gt: new Date() } };
    } else if (status === 'closed') {
      query = { $or: [{ isClosed: true }, { closingTime: { $lt: new Date() } }] };
    }
    
    const auctions = await AuctionItem.find(query).sort({ createdAt: -1 });
    res.json(auctions);
  } catch (error) {
    console.error('Fetching Auctions Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Get a single auction item by ID
app.get('/auctions/:id', async (req, res) => {
  try {
    const auctionItem = await AuctionItem.findById(req.params.id);
    if (!auctionItem) {
      return res.status(404).json({ message: 'Auction not found' });
    }

    // Check if auction should be closed
    if (!auctionItem.isClosed && new Date() > new Date(auctionItem.closingTime)) {
      auctionItem.isClosed = true;
      await auctionItem.save();
    }

    res.json(auctionItem);

  } catch (error) {
    console.error('Fetching Auction Item Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Bidding on an item (Protected)
app.post('/bid/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { bid } = req.body;
    const item = await AuctionItem.findById(id);

    if (!item) return res.status(404).json({ message: 'Auction item not found' });  
    
    // Check if auction is closed
    if (item.isClosed) {
      return res.status(400).json({ 
        message: 'Auction is closed', 
        winner: item.highestBidder 
      });  
    }
    
    // Check if auction time has passed
    if (new Date() > new Date(item.closingTime)) {  
      item.isClosed = true;  
      await item.save();  
      return res.status(400).json({ 
        message: 'Auction closed', 
        winner: item.highestBidder 
      });  
    }  

    // Validate bid amount
    if (bid <= item.currentBid) {  
      return res.status(400).json({ 
        message: 'Bid must be higher than current bid',
        currentBid: item.currentBid
      });  
    }  

    // Update the bid
    item.currentBid = bid;  
    item.highestBidder = req.user.username;  
    await item.save();  
    
    res.json({ 
      message: 'Bid successful', 
      item,
      yourBid: bid
    });

  } catch (error) {
    console.error('Bidding Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  mongoose.connection.close();
  process.exit(0);
});    });  
    await newUser.save();

    res.status(201).json({ message: 'User registered successfully' });

  } catch (error) {
    console.error('Signup Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Signin Route - Fixed password comparison
app.post('/signin', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Compare hashed password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ 
      userId: user._id, 
      username: user.username 
    }, SECRET_KEY, { 
      expiresIn: '1h' 
    });
    
    res.json({ 
      message: 'Signin successful', 
      token,
      user: {
        id: user._id,
        username: user.username
      }
    });

  } catch (error) {
    console.error('Signin Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Create Auction Item (Protected)
app.post('/auction', authenticate, async (req, res) => {
  try {
    const { itemName, description, startingBid, closingTime } = req.body;

    if (!itemName || !description || !startingBid || !closingTime) {  
      return res.status(400).json({ message: 'All fields are required' });  
    }  

    const newItem = new AuctionItem({  
      itemName,  
      description,  
      currentBid: startingBid,
      startingBid: startingBid, // Store starting bid separately
      highestBidder: '',  
      closingTime,  
    });  

    await newItem.save();  
    res.status(201).json({ 
      message: 'Auction item created', 
      item: newItem 
    });

  } catch (error) {
    console.error('Auction Post Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Get all auction items with optional filtering
app.get('/auctions', async (req, res) => {
  try {
    const { status } = req.query;
    let query = {};
    
    if (status === 'active') {
      query = { isClosed: false, closingTime: { $gt: new Date() } };
    } else if (status === 'closed') {
      query = { $or: [{ isClosed: true }, { closingTime: { $lt: new Date() } }] };
    }
    
    const auctions = await AuctionItem.find(query).sort({ createdAt: -1 });
    res.json(auctions);
  } catch (error) {
    console.error('Fetching Auctions Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Get a single auction item by ID
app.get('/auctions/:id', async (req, res) => {
  try {
    const auctionItem = await AuctionItem.findById(req.params.id);
    if (!auctionItem) {
      return res.status(404).json({ message: 'Auction not found' });
    }

    // Check if auction should be closed
    if (!auctionItem.isClosed && new Date() > new Date(auctionItem.closingTime)) {
      auctionItem.isClosed = true;
      await auctionItem.save();
    }

    res.json(auctionItem);

  } catch (error) {
    console.error('Fetching Auction Item Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Bidding on an item (Protected)
app.post('/bid/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { bid } = req.body;
    const item = await AuctionItem.findById(id);

    if (!item) return res.status(404).json({ message: 'Auction item not found' });  
    
    // Check if auction is closed
    if (item.isClosed) {
      return res.status(400).json({ 
        message: 'Auction is closed', 
        winner: item.highestBidder 
      });  
    }
    
    // Check if auction time has passed
    if (new Date() > new Date(item.closingTime)) {  
      item.isClosed = true;  
      await item.save();  
      return res.status(400).json({ 
        message: 'Auction closed', 
        winner: item.highestBidder 
      });  
    }  

    // Validate bid amount
    if (bid <= item.currentBid) {  
      return res.status(400).json({ 
        message: 'Bid must be higher than current bid',
        currentBid: item.currentBid
      });  
    }  

    // Update the bid
    item.currentBid = bid;  
    item.highestBidder = req.user.username;  
    await item.save();  
    
    res.json({ 
      message: 'Bid successful', 
      item,
      yourBid: bid
    });

  } catch (error) {
    console.error('Bidding Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  mongoose.connection.close();
  process.exit(0);
});
