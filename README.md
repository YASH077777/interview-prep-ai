# Interview Prep AI

## Run locally
1. **Backend**
   ```bash
   cd backend
   cp .env.example .env     # then edit .env: MONGO_URI, JWT_SECRET, GROQ_API_KEY
   npm install
   npm run dev              # should print "MongoDB Connected" and "Server running on port 5000"
   ```
2. **Frontend** (new terminal)
   ```bash
   cd frontend
   npm install
   npm run dev              # open http://localhost:5173
   ```

## Common problems
- **Sign up / login fails:** backend isn't running, or `backend/.env` is missing/incorrect.
- **MongoDB Atlas:** add your IP under Network Access (0.0.0.0/0 for testing) and use a database user's password in `MONGO_URI`.
- **AI features fail:** check `GROQ_API_KEY`.
