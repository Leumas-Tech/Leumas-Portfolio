# Programmable Resume

This project is a customizable, programmable resume website that you can host yourself. It's designed to be easily updatable and to showcase your skills and experience in a modern, attractive way.

## Features

*   **Single-Page Application (SPA):** A fast, modern user experience with no page reloads.
*   **Data-Driven:** All content is loaded from simple JSON files, making it easy to update your information.
*   **Music-Reactive Background:** An eye-catching, animated starfield background that reacts to music.
*   **Easy to Customize:** The frontend is built with plain JavaScript, HTML, and CSS, so it's easy to modify and extend.
*   **Simple API:** The backend is a simple Node.js/Express server with a straightforward API.

## Getting Started

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Leumas-Tech/Leumas-Portfolio
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Update your information:**
    Edit the JSON files in the `data` directory to add your own profile information, resume, portfolio, etc.
4.  **Start the server:**
    ```bash
    npm start
    ```
5.  **Open your browser:**
    Navigate to `http://localhost:4267` to see your new resume website.

## Project Structure

*   `server.js`: The main Express.js server.
*   `router.js`: The API router.
*   `adapters/`: API endpoint handlers.
*   `data/`: JSON data files.
*   `public/`: The frontend (HTML, CSS, JavaScript).
*   `helpers/`: Helper scripts.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request if you have any ideas for improvements.