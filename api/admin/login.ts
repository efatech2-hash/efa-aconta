import jwt from 'jsonwebtoken';

export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (email === process.env.SUPER_ADMIN_EMAIL && password === process.env.SUPER_ADMIN_PASSWORD) {
    const secret = process.env.JWT_SECRET || 'efa_super_admin_jwt_secret_key_2026';
    const token = jwt.sign({ email, role: 'super_admin' }, secret, { expiresIn: '8h' });
    return res.status(200).json({ token, success: true });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
}
