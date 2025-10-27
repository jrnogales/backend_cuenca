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

// === UI del carrito ===
router.get('/cart', requireAuth, showCart);

// === APIs del carrito ===
router.post('/cart/add', requireAuth, addToCart);
router.post('/cart/update', requireAuth, updateCartItem);
router.post('/cart/remove/:id', requireAuth, removeFromCart);

// === Checkout ===
// Si el usuario llega por GET (por ejemplo, después del login), mostramos una vista
// que toma el carrito del localStorage y dispara el POST automáticamente.
router.get('/cart/checkout', requireAuth, (req, res) => {
  res.render('cart-checkout', { title: 'Procesando pago' });
});

// Checkout real (POST)
router.post('/cart/checkout', requireAuth, checkoutCart);

export default router;

