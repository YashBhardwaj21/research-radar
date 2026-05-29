from fastapi import FastAPI
import uvicorn

app = FastAPI(title="Research Intelligence API", version="2.0.0")

@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "intelligence_engine"}

from .api.research import router as research_router
app.include_router(research_router)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
