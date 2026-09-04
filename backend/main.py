from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from supabase import create_client, Client
from google import genai
import httpx
import os


# =========================================================
# ENVIRONMENT VARIABLES
# =========================================================

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("SUPABASE_URL or SUPABASE_KEY is missing from .env")

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY is missing from .env")


# =========================================================
# CLIENTS
# =========================================================

supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)

gemini = genai.Client(
    api_key=GEMINI_API_KEY
)


# =========================================================
# FASTAPI APP
# =========================================================

app = FastAPI(title="WeatherGPT API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://weathergpt-murex-beta.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# CHAT REQUEST MODEL
# =========================================================

class ChatRequest(BaseModel):
    message: str
    city: str = "Delhi"


# =========================================================
# HOME
# =========================================================

@app.get("/")
def home():
    return {
        "message": "WeatherGPT backend is running!",
        "supabase": "connected",
        "gemini": "connected"
    }


# =========================================================
# LOCATION HELPER
# =========================================================

async def get_location(city: str):

    async with httpx.AsyncClient() as client:

        response = await client.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={
                "name": city,
                "count": 1,
                "language": "en",
                "format": "json"
            }
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="Location service unavailable"
        )

    data = response.json()

    if not data.get("results"):
        raise HTTPException(
            status_code=404,
            detail=f"City '{city}' not found"
        )

    return data["results"][0]


# =========================================================
# CURRENT WEATHER
# =========================================================

@app.get("/weather")
async def get_weather(city: str):

    location = await get_location(city)

    latitude = location["latitude"]
    longitude = location["longitude"]

    async with httpx.AsyncClient() as client:

        response = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": latitude,
                "longitude": longitude,
                "current": (
                    "temperature_2m,"
                    "relative_humidity_2m,"
                    "apparent_temperature,"
                    "wind_speed_10m,"
                    "precipitation,"
                    "weather_code"
                ),
                "timezone": "auto"
            }
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="Weather service unavailable"
        )

    data = response.json()
    current = data["current"]

    weather_record = {
        "city": location["name"],
        "temperature": current["temperature_2m"],
        "feels_like": current["apparent_temperature"],
        "humidity": current["relative_humidity_2m"],
        "wind_speed": current["wind_speed_10m"]
    }

    try:

        supabase.table("weather_queries").insert(
            weather_record
        ).execute()

        database_status = "weather data saved to Supabase"

    except Exception as e:

        print("Supabase insert error:", e)

        database_status = "weather retrieved, database save failed"

    return {
        "success": True,

        "location": {
            "city": location["name"],
            "country": location.get("country"),
            "latitude": latitude,
            "longitude": longitude
        },

        "weather": {
            "temperature": current["temperature_2m"],
            "feels_like": current["apparent_temperature"],
            "humidity": current["relative_humidity_2m"],
            "wind_speed": current["wind_speed_10m"],
            "precipitation": current["precipitation"],
            "weather_code": current["weather_code"],
            "time": current["time"]
        },

        "database": database_status
    }


# =========================================================
# 7-DAY FORECAST
# =========================================================

@app.get("/forecast")
async def get_forecast(city: str):

    location = await get_location(city)

    latitude = location["latitude"]
    longitude = location["longitude"]

    async with httpx.AsyncClient() as client:

        response = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": latitude,
                "longitude": longitude,
                "daily": (
                    "weather_code,"
                    "temperature_2m_max,"
                    "temperature_2m_min,"
                    "precipitation_sum,"
                    "wind_speed_10m_max"
                ),
                "timezone": "auto",
                "forecast_days": 7
            }
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="Forecast service unavailable"
        )

    data = response.json()
    daily = data["daily"]

    forecast = []

    for i in range(len(daily["time"])):

        forecast.append({
            "date": daily["time"][i],
            "weather_code": daily["weather_code"][i],
            "max_temperature": daily["temperature_2m_max"][i],
            "min_temperature": daily["temperature_2m_min"][i],
            "precipitation": daily["precipitation_sum"][i],
            "max_wind_speed": daily["wind_speed_10m_max"][i]
        })

    return {
        "success": True,

        "location": {
            "city": location["name"],
            "country": location.get("country"),
            "latitude": latitude,
            "longitude": longitude
        },

        "forecast": forecast
    }


# =========================================================
# WEATHER CODE INTERPRETATION
# =========================================================

def interpret_weather_code(code: int):

    if code == 0:
        return {
            "condition": "Clear sky",
            "emoji": "☀️",
            "severity": "normal",
            "advice": "Good weather for outdoor activities."
        }

    if code in [1, 2, 3]:
        return {
            "condition": "Partly cloudy",
            "emoji": "🌤️",
            "severity": "normal",
            "advice": "Generally good weather for outdoor activities."
        }

    if code in [45, 48]:
        return {
            "condition": "Fog",
            "emoji": "🌫️",
            "severity": "moderate",
            "advice": "Visibility may be reduced. Drive carefully."
        }

    if code in [51, 53, 55, 56, 57]:
        return {
            "condition": "Drizzle",
            "emoji": "🌦️",
            "severity": "low",
            "advice": "Light rain is possible. Carry an umbrella."
        }

    if code in [61, 63, 65, 66, 67]:
        return {
            "condition": "Rain",
            "emoji": "🌧️",
            "severity": "moderate",
            "advice": "Carry an umbrella and be careful on wet roads."
        }

    if code in [71, 73, 75, 77]:
        return {
            "condition": "Snow",
            "emoji": "❄️",
            "severity": "moderate",
            "advice": "Stay warm and travel carefully."
        }

    if code in [80, 81, 82]:
        return {
            "condition": "Rain showers",
            "emoji": "🌧️",
            "severity": "moderate",
            "advice": "Carry an umbrella."
        }

    if code in [85, 86]:
        return {
            "condition": "Snow showers",
            "emoji": "🌨️",
            "severity": "moderate",
            "advice": "Travel carefully and stay warm."
        }

    if code in [95, 96, 99]:
        return {
            "condition": "Thunderstorm",
            "emoji": "⛈️",
            "severity": "high",
            "advice": "Seek shelter indoors and avoid open areas."
        }

    return {
        "condition": "Unknown",
        "emoji": "🌡️",
        "severity": "unknown",
        "advice": "Check the latest weather updates."
    }


# =========================================================
# WEATHER INSIGHTS
# =========================================================

@app.get("/insights")
async def get_insights(city: str):

    location = await get_location(city)

    async with httpx.AsyncClient() as client:

        response = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": location["latitude"],
                "longitude": location["longitude"],
                "current": (
                    "temperature_2m,"
                    "relative_humidity_2m,"
                    "apparent_temperature,"
                    "wind_speed_10m,"
                    "weather_code"
                ),
                "timezone": "auto"
            }
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="Weather service unavailable"
        )

    current = response.json()["current"]

    interpretation = interpret_weather_code(
        current["weather_code"]
    )

    feels_like = current["apparent_temperature"]

    heat_warning = None

    if feels_like >= 40:

        heat_warning = (
            "Extreme heat. Avoid prolonged outdoor activity "
            "and stay hydrated."
        )

    elif feels_like >= 35:

        heat_warning = (
            "High heat. Stay hydrated and avoid excessive "
            "outdoor activity."
        )

    return {
        "success": True,

        "location": {
            "city": location["name"],
            "country": location.get("country")
        },

        "weather": {
            "temperature": current["temperature_2m"],
            "feels_like": current["apparent_temperature"],
            "humidity": current["relative_humidity_2m"],
            "wind_speed": current["wind_speed_10m"],
            "weather_code": current["weather_code"]
        },

        "interpretation": interpretation,

        "heat_warning": heat_warning
    }


# =========================================================
# WEATHER ALERTS
# =========================================================

@app.get("/alerts")
async def get_alerts(city: str):

    location = await get_location(city)

    async with httpx.AsyncClient() as client:

        response = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": location["latitude"],
                "longitude": location["longitude"],
                "current": (
                    "temperature_2m,"
                    "relative_humidity_2m,"
                    "apparent_temperature,"
                    "precipitation,"
                    "wind_speed_10m,"
                    "weather_code"
                ),
                "timezone": "auto"
            }
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="Weather service unavailable"
        )

    current = response.json()["current"]

    temperature = current["temperature_2m"]
    feels_like = current["apparent_temperature"]
    wind_speed = current["wind_speed_10m"]
    precipitation = current["precipitation"]
    weather_code = current["weather_code"]

    alerts = []

    if feels_like >= 40:

        alerts.append({
            "type": "Extreme Heat",
            "severity": "HIGH",
            "message": "Extreme heat conditions detected.",
            "action": (
                "Stay indoors when possible and stay hydrated."
            )
        })

    elif feels_like >= 35:

        alerts.append({
            "type": "Heat Warning",
            "severity": "MODERATE",
            "message": "High heat conditions detected.",
            "action": (
                "Stay hydrated and avoid prolonged sun exposure."
            )
        })

    if wind_speed >= 50:

        alerts.append({
            "type": "Dangerous Wind",
            "severity": "HIGH",
            "message": "Very strong winds detected.",
            "action": (
                "Stay indoors and avoid unsecured structures."
            )
        })

    elif wind_speed >= 30:

        alerts.append({
            "type": "Strong Wind",
            "severity": "MODERATE",
            "message": "Strong winds detected.",
            "action": (
                "Secure loose objects and travel carefully."
            )
        })

    if weather_code in [95, 96, 99]:

        alerts.append({
            "type": "Thunderstorm",
            "severity": "HIGH",
            "message": "Thunderstorm conditions detected.",
            "action": (
                "Seek shelter indoors and avoid open areas."
            )
        })

    if precipitation >= 20:

        alerts.append({
            "type": "Heavy Rain",
            "severity": "HIGH",
            "message": "Heavy rainfall detected.",
            "action": (
                "Avoid flooded and low-lying areas."
            )
        })

    elif precipitation >= 5:

        alerts.append({
            "type": "Rain",
            "severity": "MODERATE",
            "message": "Rainfall detected.",
            "action": (
                "Carry an umbrella and drive carefully."
            )
        })

    if not alerts:

        alerts.append({
            "type": "No Major Alert",
            "severity": "NORMAL",
            "message": "No major weather hazard detected.",
            "action": "Normal activities can continue."
        })

    return {
        "success": True,

        "location": {
            "city": location["name"],
            "country": location.get("country")
        },

        "current_conditions": {
            "temperature": temperature,
            "feels_like": feels_like,
            "wind_speed": wind_speed,
            "precipitation": precipitation,
            "weather_code": weather_code
        },

        "alerts": alerts
    }


# =========================================================
# AI WEATHER CHATBOT
# =========================================================

@app.post("/chat")
async def chat(request: ChatRequest):

    city = request.city
    user_message = request.message

    if not user_message.strip():
        raise HTTPException(
            status_code=400,
            detail="Message cannot be empty"
        )

    # -----------------------------------------------------
    # Get location
    # -----------------------------------------------------

    location = await get_location(city)

    latitude = location["latitude"]
    longitude = location["longitude"]

    # -----------------------------------------------------
    # Get current weather + forecast
    # -----------------------------------------------------

    async with httpx.AsyncClient() as client:

        weather_response = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": latitude,
                "longitude": longitude,
                "current": (
                    "temperature_2m,"
                    "relative_humidity_2m,"
                    "apparent_temperature,"
                    "wind_speed_10m,"
                    "precipitation,"
                    "weather_code"
                ),
                "timezone": "auto"
            }
        )

        forecast_response = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": latitude,
                "longitude": longitude,
                "daily": (
                    "weather_code,"
                    "temperature_2m_max,"
                    "temperature_2m_min,"
                    "precipitation_sum"
                ),
                "timezone": "auto",
                "forecast_days": 7
            }
        )

    if weather_response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="Weather service unavailable"
        )

    if forecast_response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="Forecast service unavailable"
        )

    current = weather_response.json()["current"]
    daily = forecast_response.json()["daily"]

    # -----------------------------------------------------
    # Prepare forecast
    # -----------------------------------------------------

    forecast = []

    for i in range(len(daily["time"])):

        forecast.append({
            "date": daily["time"][i],
            "max_temperature": daily["temperature_2m_max"][i],
            "min_temperature": daily["temperature_2m_min"][i],
            "precipitation": daily["precipitation_sum"][i],
            "weather_code": daily["weather_code"][i]
        })

    # -----------------------------------------------------
    # Weather interpretation
    # -----------------------------------------------------

    interpretation = interpret_weather_code(
        current["weather_code"]
    )

    # -----------------------------------------------------
    # AI prompt
    # -----------------------------------------------------

    prompt = f"""
You are WeatherGPT, an intelligent weather assistant.

The user is asking:
{user_message}

Selected city:
{location["name"]}, {location.get("country")}

Current weather:
Temperature: {current["temperature_2m"]} °C
Feels like: {current["apparent_temperature"]} °C
Humidity: {current["relative_humidity_2m"]} %
Wind speed: {current["wind_speed_10m"]} km/h
Precipitation: {current["precipitation"]} mm
Weather condition: {interpretation["condition"]}
Weather code: {current["weather_code"]}

7-day forecast:
{forecast}

Instructions:
- Answer the user's weather question clearly.
- Use the supplied live weather information.
- Do not invent weather information.
- Use Celsius for temperature.
- Use km/h for wind speed.
- Give practical advice when appropriate.
- If there is dangerous weather, clearly mention the danger.
- If the question is not related to weather, politely explain that you are WeatherGPT.
- Keep the response concise and easy to understand.
"""

    # -----------------------------------------------------
    # Gemini
    # -----------------------------------------------------

    try:

        response = gemini.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt
        )

        answer = response.text

    except Exception as e:

        print("Gemini error:", e)

        raise HTTPException(
            status_code=502,
            detail="AI service unavailable"
        )

    # -----------------------------------------------------
    # Save chat to Supabase
    # -----------------------------------------------------

    try:

        supabase.table("chat_history").insert({
            "city": location["name"],
            "user_message": user_message,
            "ai_response": answer
        }).execute()

        history_status = "conversation saved"

    except Exception as e:

        print("Chat history insert error:", e)

        history_status = "conversation generated, but history save failed"

    # -----------------------------------------------------
    # Return response
    # -----------------------------------------------------

    return {
        "success": True,

        "city": location["name"],

        "question": user_message,

        "answer": answer,

        "database": history_status
    }


# =========================================================
# CHAT HISTORY
# =========================================================

@app.get("/history")
async def get_history():

    try:

        response = (
            supabase
            .table("chat_history")
            .select("*")
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )

        return {
            "success": True,
            "count": len(response.data),
            "history": response.data
        }

    except Exception as e:

        print("Chat history read error:", e)

        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve chat history"
        )