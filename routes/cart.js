// routes/cart.js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { checkoutCart } from '../controllers/cartController.js';

const router = express.Router();

/** GET /cart/checkout – vista que auto-postea el carrito del localStorage */
router.get('/cart/checkout', requireAuth, (req, res) => {
  res.render('cart-checkout', { title: 'Procesando pago' });
});

/** POST /cart/checkout – procesa la compra usando req.body.items */
router.post('/cart/checkout', requireAuth, checkoutCart);

export default router;


