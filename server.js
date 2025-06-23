const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? [process.env.ADMIN_FRONTEND_URL, process.env.USER_FRONTEND_URL]
        : 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Movie Schema
const movieSchema = new mongoose.Schema({
    title: { type: String, required: true },
    year: { type: Number, required: true },
    genres: [{ type: String }],
    rating: { type: Number, required: true },
    poster: { type: String, required: true },
    watchUrl: { type: String, required: true },
    downloadUrl: { type: String, required: true },
    featured: { type: Boolean, default: false },
    pinned: { type: Boolean, default: false },
    status: { type: String, default: 'active' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Admin Schema
const adminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, default: 'admin' },
    lastLogin: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

const Movie = mongoose.model('Movie', movieSchema);
const Admin = mongoose.model('Admin', adminSchema);

// Authentication Middleware
const authenticateAdmin = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const admin = await Admin.findById(decoded.adminId);
        
        if (!admin) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        req.admin = admin;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Admin Routes
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const admin = await Admin.findOne({ username });
        if (!admin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isValidPassword = await bcrypt.compare(password, admin.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        admin.lastLogin = new Date();
        await admin.save();

        const token = jwt.sign(
            { adminId: admin._id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            admin: {
                id: admin._id,
                username: admin.username,
                email: admin.email,
                role: admin.role
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/admin/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        
        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ 
            $or: [{ username }, { email }] 
        });
        
        if (existingAdmin) {
            return res.status(400).json({ 
                error: 'Username or email already exists' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create new admin
        const admin = new Admin({
            username,
            password: hashedPassword,
            email
        });

        await admin.save();

        res.status(201).json({ 
            message: 'Admin account created successfully' 
        });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Protected Admin Routes
app.get('/api/admin/dashboard', authenticateAdmin, async (req, res) => {
    try {
        const stats = {
            totalMovies: await Movie.countDocuments(),
            activeMovies: await Movie.countDocuments({ status: 'active' }),
            featuredMovies: await Movie.countDocuments({ featured: true }),
            pinnedMovies: await Movie.countDocuments({ pinned: true })
        };
        
        const recentMovies = await Movie.find()
            .sort({ createdAt: -1 })
            .limit(5);

        res.json({ stats, recentMovies });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
});

// Movie Routes
app.get('/api/movies', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 24;
        const skip = (page - 1) * limit;

        const totalMovies = await Movie.countDocuments();
        const movies = await Movie.find()
            .sort({ pinned: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            movies,
            currentPage: page,
            totalPages: Math.ceil(totalMovies / limit),
            totalMovies
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch movies' });
    }
});

app.get('/api/movies/search', async (req, res) => {
    try {
        const { query } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 24;
        const skip = (page - 1) * limit;

        const searchRegex = new RegExp(query, 'i');
        const totalMovies = await Movie.countDocuments({
            $or: [
                { title: searchRegex },
                { genres: searchRegex }
            ]
        });

        const movies = await Movie.find({
            $or: [
                { title: searchRegex },
                { genres: searchRegex }
            ]
        })
            .sort({ pinned: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            movies,
            currentPage: page,
            totalPages: Math.ceil(totalMovies / limit),
            totalMovies
        });
    } catch (error) {
        res.status(500).json({ error: 'Search failed' });
    }
});

app.get('/api/movies/genre/:genres', async (req, res) => {
    try {
        const genres = req.params.genres.split(',');
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 24;
        const skip = (page - 1) * limit;

        const totalMovies = await Movie.countDocuments({
            genres: { $in: genres }
        });

        const movies = await Movie.find({
            genres: { $in: genres }
        })
            .sort({ pinned: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            movies,
            currentPage: page,
            totalPages: Math.ceil(totalMovies / limit),
            totalMovies
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch movies by genre' });
    }
});

// Protected Movie Management Routes
app.post('/api/movies', authenticateAdmin, async (req, res) => {
    try {
        const movie = new Movie(req.body);
        await movie.save();
        res.status(201).json(movie);
    } catch (error) {
        res.status(500).json({ error: 'Failed to add movie' });
    }
});

app.put('/api/movies/:id', authenticateAdmin, async (req, res) => {
    try {
        const movie = await Movie.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }
        res.json(movie);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update movie' });
    }
});

app.delete('/api/movies/:id', authenticateAdmin, async (req, res) => {
    try {
        const movie = await Movie.findByIdAndDelete(req.params.id);
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }
        res.json({ message: 'Movie deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete movie' });
    }
});

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static('public'));
    app.get('*', (req, res) => {
        res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 