'use strict';
// Default markets, created on first start.
module.exports.MARKETS = [
  { symbol: 'BTC/USDT', name: 'Bitcoin', base: 'BTC', quote: 'USDT', price: 70320, volatility: 0.0003, max_leverage: 100, fee_rate: 0.0005, decimals: 1 },
  { symbol: 'ETH/USDT', name: 'Ethereum', base: 'ETH', quote: 'USDT', price: 3450, volatility: 0.0004, max_leverage: 100, fee_rate: 0.0005, decimals: 2 },
  { symbol: 'SOL/USDT', name: 'Solana', base: 'SOL', quote: 'USDT', price: 165.4, volatility: 0.0006, max_leverage: 50, fee_rate: 0.0006, decimals: 3 },
  { symbol: 'BNB/USDT', name: 'BNB', base: 'BNB', quote: 'USDT', price: 612.5, volatility: 0.0004, max_leverage: 50, fee_rate: 0.0006, decimals: 2 },
  { symbol: 'XAU/USD', name: 'Gold', base: 'XAU', quote: 'USD', price: 2650, volatility: 0.00015, max_leverage: 100, fee_rate: 0.0004, decimals: 2 },
  { symbol: 'EUR/USD', name: 'Euro / Dollar', base: 'EUR', quote: 'USD', price: 1.0842, volatility: 0.0001, max_leverage: 200, fee_rate: 0.0002, decimals: 5 },
];
