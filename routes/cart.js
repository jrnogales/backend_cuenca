// routes/cart.js
import express from 'express';
import {
  showCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  checkoutCart,
} from '../controllers/cartController.js';

const router = express.Router();

// Página del carrito (opcional, si la usas)
router.get('/cart', showCart);

// API del carrito
router.post('/cart/add', addToCart);
router.post('/cart/update', updateCartItem);
router.post('/cart/remove/:id', removeFromCart);
router.post('/cart/checkout', checkoutCart);

export default router;
