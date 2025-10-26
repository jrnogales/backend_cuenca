// routes/cart.js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  showCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  checkoutCart
} from '../controllers/cartController.js';

const router = express.Router();

// UI del carrito
router.get('/cart', requireAuth, showCart);

// APIs del carrito
router.post('/cart/add', requireAuth, addToCart);
router.post('/cart/update', requireAuth, updateCartItem);
router.post('/cart/remove/:id', requireAuth, removeFromCart);
router.post('/cart/checkout', requireAuth, checkoutCart);

export default router;
