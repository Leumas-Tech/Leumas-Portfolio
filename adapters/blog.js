// adapters/blog.js
const blog = require('../data/blog.json');
const profile = require('../data/profile.json');

module.exports = {
  id: 'blog',
  async get() {
    return { profile, posts: blog.posts };
  }
};
