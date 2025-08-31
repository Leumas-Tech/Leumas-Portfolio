// router.js
const { Router } = require('express');
const { mount, list } = require('./adapters');
const router = Router();

// mount every adapter as /api/<adapterId>
mount(router);

// quick adapter index
router.get('/', (_req, res) => res.json({ adapters: list() }));

module.exports = router;
