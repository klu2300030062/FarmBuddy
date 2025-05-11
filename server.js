/**
 * Agriculture Project Backend - Farmer-Friendly Web App
 * 
 * Simple Express.js REST API backend with in-memory (file) persistence.
 * Features:
 * - User registration and login simulation (no password security for demo)
 * - Farmers can add/list products
 * - Buyers can place orders and view orders
 * - Market trends aggregated from product and order data
 * 
 * Run: node server.js
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Data files paths
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// Load or initialize data
function loadData(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8');
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw || '[]');
}

function saveData(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

let users = loadData(USERS_FILE);       // {id, type, name, token}
let products = loadData(PRODUCTS_FILE); // {id, farmerId, name, desc, price, quantity}
let orders = loadData(ORDERS_FILE);     // {id, productId, buyerId, qty, date}

const app = express();
app.use(bodyParser.json());

// CORS middleware for development
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // allow any origin
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Utility helper: generate id and token
function genId() {
  return crypto.randomBytes(8).toString('hex');
}
function genToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Middleware: authenticate user by token
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if(!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.substring(7);
  const user = users.find(u => u.token === token);
  if(!user) return res.status(401).json({ error: 'Invalid token' });
  req.user = user;
  next();
}

// POST /register
// Body: { name: string, type: "farmer"|"buyer" }
// Returns: user object with token
app.post('/register', (req, res) => {
  const { name, type } = req.body;
  if(!name || !type || (type !== 'farmer' && type !== 'buyer')) {
    return res.status(400).json({ error: 'Invalid registration data' });
  }
  if(users.find(u => u.name === name && u.type === type)) {
    return res.status(400).json({ error: 'User already exists with this name and type' });
  }
  const id = genId();
  const token = genToken();
  const newUser = { id, name, type, token };
  users.push(newUser);
  saveData(USERS_FILE, users);
  res.json({ id, name, type, token });
});

// POST /login
// Body: { name, type }
// Returns: user object with token
// (No password for demo purpose)
app.post('/login', (req, res) => {
  const { name, type } = req.body;
  if(!name || !type || (type !== 'farmer' && type !== 'buyer')) {
    return res.status(400).json({ error: 'Invalid login data' });
  }
  const user = users.find(u => u.name === name && u.type === type);
  if(!user) return res.status(400).json({ error: 'User not found, please register' });
  // Refresh token on login
  user.token = genToken();
  saveData(USERS_FILE, users);
  res.json({ id: user.id, name: user.name, type: user.type, token: user.token });
});

// GET /products
// Public endpoint: returns list of products with aggregated availability info
app.get('/products', (req, res) => {
  // For each product calculate available quantity subtracting ordered qty
  const prodsWithAvail = products.map(p => {
    const soldQty = orders.filter(o => o.productId === p.id).reduce((acc,o) => acc + o.qty, 0);
    return {
      id: p.id,
      farmerId: p.farmerId,
      farmerName: (()=>{
        const u = users.find(u=>u.id===p.farmerId);
        return u ? u.name : 'Unknown';
      })(),
      name: p.name,
      desc: p.desc,
      price: p.price,
      quantityAvailable: p.quantity - soldQty
    };
  }).filter(p => p.quantityAvailable > 0);
  res.json(prodsWithAvail);
});

// GET /products/:id
app.get('/products/:id', (req, res) => {
  const id = req.params.id;
  const product = products.find(p => p.id === id);
  if(!product) return res.status(404).json({ error: 'Product not found' });
  const soldQty = orders.filter(o => o.productId === product.id).reduce((acc,o) => acc + o.qty, 0);
  const availability = product.quantity - soldQty;
  const farmer = users.find(u => u.id === product.farmerId);
  res.json({
    ...product,
    farmerName: farmer ? farmer.name : 'Unknown',
    quantityAvailable: availability
  });
});

// POST /products
// Add product - only for farmers (auth required)
app.post('/products', authMiddleware, (req, res) => {
  if(req.user.type !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can add products' });
  }
  const { name, desc, price, quantity } = req.body;
  if(!name || typeof price !== 'number' || price <= 0 || typeof quantity !== 'number' || quantity <= 0) {
    return res.status(400).json({ error: 'Invalid product data' });
  }
  const newProd = {
    id: genId(),
    farmerId: req.user.id,
    name,
    desc: desc || '',
    price,
    quantity
  };
  products.push(newProd);
  saveData(PRODUCTS_FILE, products);
  res.json(newProd);
});

// POST /orders
// Place order - only buyers can order (auth required)
// Body: { productId, qty }
app.post('/orders', authMiddleware, (req, res) => {
  if(req.user.type !== 'buyer') {
    return res.status(403).json({ error: 'Only buyers can place orders' });
  }
  const { productId, qty } = req.body;
  if(!productId || typeof qty !== 'number' || qty <= 0) {
    return res.status(400).json({ error: 'Invalid order data' });
  }
  const product = products.find(p => p.id === productId);
  if(!product) return res.status(404).json({ error: 'Product not found' });

  // Check availability
  const soldQty = orders.filter(o => o.productId === productId).reduce((acc,o) => acc + o.qty, 0);
  const available = product.quantity - soldQty;
  if(qty > available) {
    return res.status(400).json({ error: `Quantity requested (${qty}) exceeds available quantity (${available})` });
  }
  const newOrder = {
    id: genId(),
    productId,
    buyerId: req.user.id,
    qty,
    date: new Date().toISOString()
  };
  orders.push(newOrder);
  saveData(ORDERS_FILE, orders);
  res.json(newOrder);
});

// GET /orders
// Get orders for authenticated user (buyers see their orders, farmers see sales of their products)
app.get('/orders', authMiddleware, (req, res) => {
  if(req.user.type === 'buyer') {
    // Return orders placed by buyer with product info
    const userOrders = orders.filter(o => o.buyerId === req.user.id).map(o => {
      const product = products.find(p => p.id === o.productId);
      return {
        ...o,
        productName: product ? product.name : 'Unknown',
        farmerId: product ? product.farmerId : null
      };
    });
    return res.json(userOrders);
  } else if(req.user.type === 'farmer') {
    // Return all orders for farmer's products with buyer info
    const farmerProds = products.filter(p => p.farmerId === req.user.id).map(p => p.id);
    const farmerOrders = orders.filter(o => farmerProds.includes(o.productId)).map(o => {
      const buyer = users.find(u => u.id === o.buyerId);
      const product = products.find(p => p.id === o.productId);
      return {
        ...o,
        buyerName: buyer ? buyer.name : 'Unknown',
        productName: product ? product.name : 'Unknown'
      };
    });
    return res.json(farmerOrders);
  }
  else {
    return res.status(400).json({ error: 'Unknown user type' });
  }
});

// GET /market-trends
// Aggregate market trends: avg price & total sales by product name across farmers
app.get('/market-trends', (req, res) => {
  const trendData = {};
  products.forEach(p => {
    if(!trendData[p.name]) {
      trendData[p.name] = { totalPrice: 0, count: 0, totalSalesQty: 0 };
    }
    trendData[p.name].totalPrice += p.price;
    trendData[p.name].count++;
  });

  for(let key in trendData) {
    trendData[key].avgPrice = trendData[key].totalPrice / trendData[key].count;
    trendData[key].totalSalesQty = 0;
  }

  orders.forEach(order => {
    const product = products.find(p => p.id === order.productId);
    if(product && trendData[product.name]) {
      trendData[product.name].totalSalesQty += order.qty;
    }
  });

  res.json(trendData);
});

// Root route for sanity check
app.get('/', (req, res) => {
  res.send('Agriculture Project Backend API is running.');
});

app.listen(PORT, () => {
  console.log(`Agriculture Project Backend running at http://localhost:${PORT}`);
});

