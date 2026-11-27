'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateLaundryPricing } = require('../shared/pricing');

const PRICE_PER_LOAD = 180;
const KG_PER_LOAD = 7;

test('laundry charges one load up to and including 7 kg', () => {
    for (const weight of [0.5, 1, 3.5, 7]) {
        const pricing = calculateLaundryPricing(weight, PRICE_PER_LOAD, KG_PER_LOAD);
        assert.equal(pricing.loadCount, 1);
        assert.equal(pricing.totalAmount, 180);
    }
});

test('8 kg is rounded up to two loads and costs PHP 360', () => {
    const pricing = calculateLaundryPricing(8, PRICE_PER_LOAD, KG_PER_LOAD);
    assert.equal(pricing.loadCount, 2);
    assert.equal(pricing.totalAmount, 360);
});

test('exact multiples do not add an unnecessary extra load', () => {
    assert.equal(calculateLaundryPricing(14, PRICE_PER_LOAD, KG_PER_LOAD).loadCount, 2);
    assert.equal(calculateLaundryPricing(21, PRICE_PER_LOAD, KG_PER_LOAD).loadCount, 3);
});

test('any partial load over a full 7 kg load rounds up', () => {
    assert.equal(calculateLaundryPricing(7.5, PRICE_PER_LOAD, KG_PER_LOAD).totalAmount, 360);
    assert.equal(calculateLaundryPricing(15, PRICE_PER_LOAD, KG_PER_LOAD).totalAmount, 540);
});

test('price is read as a per-load catalog amount', () => {
    assert.equal(calculateLaundryPricing(8, 200, KG_PER_LOAD).totalAmount, 400);
});

test('invalid weights, prices, and load sizes are rejected', () => {
    assert.throws(() => calculateLaundryPricing(0, PRICE_PER_LOAD, KG_PER_LOAD), /weight/);
    assert.throws(() => calculateLaundryPricing(-1, PRICE_PER_LOAD, KG_PER_LOAD), /weight/);
    assert.throws(() => calculateLaundryPricing(8, -1, KG_PER_LOAD), /price/);
    assert.throws(() => calculateLaundryPricing(8, PRICE_PER_LOAD, 0), /kilograms per load/);
});
