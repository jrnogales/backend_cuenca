// routes/cart.js
import express from 'express';
import {
  showCart,
  addToCart,
  updateCartItem,
  removeFromCart
} from '../controllers/cartController.js';

import { crearReservasDesdeCarrito } from '../controllers/checkoutController.js';

const router = express.Router();

// Página del carrito
router.get('/cart', showCart);

// API del carrito
router.post('/cart/add', addToCart);
router.post('/cart/update', updateCartItem);
router.post('/cart/remove/:id', removeFromCart);

// Checkout unificado → CREA 1 SOLA FACTURA
router.post('/cart/checkout', crearReservasDesdeCarrito);

export default router;
