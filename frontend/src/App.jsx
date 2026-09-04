import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import "./App.css";

const API_URL = "https://weathergpt-nb9r.onrender.com";

function App() {
  const [session, setSession] = useState(null);

  // AUTH
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // WEATHER
  const [city, setCity] = useState("");
  const [searchCity, setSearchCity] = useState("");
  const [weather, setWeather] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [insights, setInsights] = useState(null);
  const [alerts, setAlerts] = useState([]);

  // CHAT
  const [chatMessage, setChatMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);

  // DATA
  const [history, setHistory] = useState([]);
  const [savedLocations, setSavedLocations] = useState([]);

  // UI
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [dashboardMessage, setDashboardMessage] = useState("");
  const [activePage, setActivePage] = useState("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationPermission, setLocationPermission] = useState("unknown");

  // VOICE
  const [isListening, setIsListening] = useState(false);
  const [speakingMessage, setSpeakingMessage] = useState(null);
  const recognitionRef = useRef(null);

  // CAMERA
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const fileInputRef = useRef(null);

  // ---------------------------------------------------------
  // SESSION
  // ---------------------------------------------------------

  useEffect(() => {
    getSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function getSession() {
    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession();

    setSession(currentSession);
  }

  // ---------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------

  async function handleAuth(event) {
    event.preventDefault();

    setAuthMessage("");
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          throw error;
        }

        setAuthMessage("Login successful! 🌦️");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) {
          throw error;
        }

        setAuthMessage(
          "Account created successfully! Check your email if confirmation is required."
        );
      }
    } catch (error) {
      setAuthMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();

    setSession(null);
    setWeather(null);
    setForecast([]);
    setInsights(null);
    setAlerts([]);
    setHistory([]);
    setSavedLocations([]);
    setMessages([]);
  }

  // ---------------------------------------------------------
  // LOCATION
  // ---------------------------------------------------------

  useEffect(() => {
    if (session) {
      detectLocation();
      loadHistory();
      loadSavedLocations();
    }
  }, [session]);

  async function detectLocation() {
    if (!navigator.geolocation) {
      setLocationPermission("unsupported");
      setCity("Delhi");
      setSearchCity("Delhi");
      loadWeather("Delhi");
      return;
    }

    setLocationLoading(true);
    setLocationPermission("requesting");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          setLocationPermission("granted");

          const { latitude, longitude } = position.coords;

          let detectedCity = "";

          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
            );

            if (response.ok) {
              const data = await response.json();

              detectedCity =
                data.address?.city ||
                data.address?.town ||
                data.address?.municipality ||
                data.address?.village ||
                data.address?.county ||
                "";
            }
          } catch {
            detectedCity = "";
          }

          if (!detectedCity) {
            detectedCity = "Delhi";
          }

          setCity(detectedCity);
          setSearchCity(detectedCity);

          await loadWeather(detectedCity);
        } catch (error) {
          setDashboardMessage(
            error.message || "Unable to detect your location."
          );
        } finally {
          setLocationLoading(false);
        }
      },
      () => {
        setLocationPermission("denied");
        setLocationLoading(false);

        setDashboardMessage(
          "Location permission was not granted. Using Delhi as a fallback."
        );

        setCity("Delhi");
        setSearchCity("Delhi");
        loadWeather("Delhi");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000,
      }
    );
  }

  // ---------------------------------------------------------
  // WEATHER
  // ---------------------------------------------------------

  async function loadWeather(selectedCity = city) {
    if (!selectedCity?.trim()) {
      return;
    }

    setWeatherLoading(true);
    setDashboardMessage("");

    try {
      const encodedCity = encodeURIComponent(selectedCity);

      const [
        weatherResponse,
        forecastResponse,
        insightsResponse,
        alertsResponse,
      ] = await Promise.all([
        fetch(`${API_URL}/weather?city=${encodedCity}`),
        fetch(`${API_URL}/forecast?city=${encodedCity}`),
        fetch(`${API_URL}/insights?city=${encodedCity}`),
        fetch(`${API_URL}/alerts?city=${encodedCity}`),
      ]);

      if (!weatherResponse.ok) {
        const errorData = await weatherResponse.json();
        throw new Error(errorData.detail || "Unable to load weather");
      }

      if (!forecastResponse.ok) {
        const errorData = await forecastResponse.json();
        throw new Error(errorData.detail || "Unable to load forecast");
      }

      if (!insightsResponse.ok) {
        const errorData = await insightsResponse.json();
        throw new Error(errorData.detail || "Unable to load insights");
      }

      if (!alertsResponse.ok) {
        const errorData = await alertsResponse.json();
        throw new Error(errorData.detail || "Unable to load alerts");
      }

      const weatherData = await weatherResponse.json();
      const forecastData = await forecastResponse.json();
      const insightsData = await insightsResponse.json();
      const alertsData = await alertsResponse.json();

      setCity(weatherData.location.city);
      setSearchCity(weatherData.location.city);

      setWeather(weatherData);
      setForecast(forecastData.forecast || []);
      setInsights(insightsData);
      setAlerts(alertsData.alerts || []);
    } catch (error) {
      setDashboardMessage(error.message);
    } finally {
      setWeatherLoading(false);
    }
  }

  function handleCitySearch(event) {
    event.preventDefault();

    if (searchCity.trim()) {
      loadWeather(searchCity.trim());
      setActivePage("chat");
    }
  }

  // ---------------------------------------------------------
  // CHAT
  // ---------------------------------------------------------

  async function askWeatherGPT(event) {
    event.preventDefault();

    if (!chatMessage.trim() || chatLoading) {
      return;
    }

    const userText = chatMessage.trim();

    setChatLoading(true);
    setChatMessage("");

    const userMessage = {
      id: Date.now(),
      role: "user",
      content: userText,
      image: imagePreview,
    };

    setMessages((previous) => [...previous, userMessage]);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userText,
          city: city || "Delhi",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "AI service unavailable");
      }

      const aiMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content: data.answer,
      };

      setMessages((previous) => [...previous, aiMessage]);

      loadHistory();
    } catch (error) {
      setMessages((previous) => [
        ...previous,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: `Sorry, I couldn't answer that. ${error.message}`,
          error: true,
        },
      ]);
    } finally {
      setChatLoading(false);
      clearImage();
    }
  }

  function startNewChat() {
    setMessages([]);
    setChatMessage("");
    clearImage();
    setActivePage("chat");
  }

  // ---------------------------------------------------------
  // VOICE INPUT
  // ---------------------------------------------------------

  function toggleVoiceInput() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setDashboardMessage(
        "Speech recognition is not supported in this browser."
      );
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let transcript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }

      setChatMessage(transcript);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  // ---------------------------------------------------------
  // TEXT TO SPEECH
  // ---------------------------------------------------------

  function speakText(text, id) {
    if (!window.speechSynthesis) {
      setDashboardMessage(
        "Text-to-speech is not supported in this browser."
      );
      return;
    }

    if (speakingMessage === id) {
      window.speechSynthesis.cancel();
      setSpeakingMessage(null);
      return;
    }

    window.speechSynthesis.cancel();

    const speech = new SpeechSynthesisUtterance(text);

    speech.lang = "en-IN";
    speech.rate = 0.95;
    speech.pitch = 1;

    speech.onstart = () => {
      setSpeakingMessage(id);
    };

    speech.onend = () => {
      setSpeakingMessage(null);
    };

    speech.onerror = () => {
      setSpeakingMessage(null);
    };

    window.speechSynthesis.speak(speech);
  }

  // ---------------------------------------------------------
  // CAMERA / IMAGE
  // ---------------------------------------------------------

  function handleImageSelect(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setDashboardMessage("Please select an image file.");
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function clearImage() {
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }

    setImagePreview(null);
    setImageFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  // ---------------------------------------------------------
  // HISTORY
  // ---------------------------------------------------------

  async function loadHistory() {
    try {
      const response = await fetch(`${API_URL}/history`);

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      setHistory(data.history || []);
    } catch (error) {
      console.error("History error:", error);
    }
  }

  // ---------------------------------------------------------
  // SAVED LOCATIONS
  // ---------------------------------------------------------

  async function loadSavedLocations() {
    if (!session?.user?.id) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from("saved_locations")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        throw error;
      }

      setSavedLocations(data || []);
    } catch (error) {
      console.error("Saved locations error:", error);
    }
  }

  async function saveLocation() {
    if (!session?.user?.id || !weather?.location) {
      return;
    }

    try {
      const { error } = await supabase.from("saved_locations").insert({
        user_id: session.user.id,
        location_name: weather.location.city,
        latitude: weather.location.latitude,
        longitude: weather.location.longitude,
      });

      if (error) {
        throw error;
      }

      setDashboardMessage("Location saved ⭐");
      loadSavedLocations();
    } catch (error) {
      setDashboardMessage(error.message);
    }
  }

  async function deleteLocation(id) {
    try {
      const { error } = await supabase
        .from("saved_locations")
        .delete()
        .eq("id", id)
        .eq("user_id", session.user.id);

      if (error) {
        throw error;
      }

      loadSavedLocations();
    } catch (error) {
      setDashboardMessage(error.message);
    }
  }

  function selectSavedLocation(locationName) {
    setSearchCity(locationName);
    setActivePage("chat");
    loadWeather(locationName);
  }

  // ---------------------------------------------------------
  // AI RESPONSE FORMATTING
  // ---------------------------------------------------------

  function formatAIResponse(text) {
    if (!text) {
      return null;
    }

    const lines = text.split("\n");

    return lines.map((line, index) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return <div key={index} className="ai-space" />;
      }

      if (/^#{1,6}\s+/.test(trimmed)) {
        const heading = trimmed.replace(/^#{1,6}\s+/, "");

        return (
          <div key={index} className="ai-heading">
            {formatInlineText(heading)}
          </div>
        );
      }

      if (/^[-*•]\s+/.test(trimmed)) {
        const bullet = trimmed.replace(/^[-*•]\s+/, "");

        return (
          <div key={index} className="ai-bullet">
            <span className="ai-bullet-dot">•</span>
            <span>{formatInlineText(bullet)}</span>
          </div>
        );
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const match = trimmed.match(/^(\d+)\.\s+(.*)$/);

        return (
          <div key={index} className="ai-numbered">
            <span className="ai-number">{match[1]}</span>
            <span>{formatInlineText(match[2])}</span>
          </div>
        );
      }

      return (
        <div key={index} className="ai-paragraph">
          {formatInlineText(trimmed)}
        </div>
      );
    });
  }

  function formatInlineText(text) {
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);

    return parts.map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }

      if (part.startsWith("*") && part.endsWith("*")) {
        return <strong key={index}>{part.slice(1, -1)}</strong>;
      }

      return part;
    });
  }

  // ---------------------------------------------------------
  // PAGE CONTENT
  // ---------------------------------------------------------

  function renderChatPage() {
    return (
      <div className="chat-page">
        {messages.length === 0 ? (
          <div className="welcome-area">
            <div className="welcome-orb">
              <span>🌦️</span>
            </div>

            <h1>How can I help with the weather?</h1>

            <p className="welcome-subtitle">
              Ask WeatherGPT anything about your sky, forecast, travel or
              outdoor plans.
            </p>

            <div className="suggestion-grid">
              <button
                onClick={() =>
                  setChatMessage("Will it rain today?")
                }
              >
                <span>🌧️</span>
                <div>
                  <strong>Will it rain today?</strong>
                  <small>Check today's rainfall</small>
                </div>
              </button>

              <button
                onClick={() =>
                  setChatMessage("What should I wear today?")
                }
              >
                <span>👕</span>
                <div>
                  <strong>What should I wear?</strong>
                  <small>Get weather-based advice</small>
                </div>
              </button>

              <button
                onClick={() =>
                  setChatMessage("Is it a good day to go outside?")
                }
              >
                <span>🌳</span>
                <div>
                  <strong>Good day to go outside?</strong>
                  <small>Outdoor activity advice</small>
                </div>
              </button>

              <button
                onClick={() =>
                  setChatMessage("What will the weather be like this week?")
                }
              >
                <span>📅</span>
                <div>
                  <strong>Weather this week?</strong>
                  <small>Understand the forecast</small>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="conversation">
            {messages.map((message) => (
              <div
                className={`message-row ${
                  message.role === "user" ? "user-row" : "assistant-row"
                }`}
                key={message.id}
              >
                <div
                  className={`message-avatar ${
                    message.role === "user"
                      ? "user-avatar"
                      : "ai-avatar"
                  }`}
                >
                  {message.role === "user" ? "U" : "✦"}
                </div>

                <div className="message-content">
                  <div className="message-name">
                    {message.role === "user" ? "You" : "WeatherGPT"}
                  </div>

                  {message.image && (
                    <img
                      className="chat-image"
                      src={message.image}
                      alt="Uploaded weather"
                    />
                  )}

                  <div
                    className={`message-text ${
                      message.error ? "error-text" : ""
                    }`}
                  >
                    {message.error
                      ? message.content
                      : formatAIResponse(message.content)}
                  </div>

                  {message.role === "assistant" && !message.error && (
                    <button
                      className="speak-button"
                      onClick={() =>
                        speakText(message.content, message.id)
                      }
                      title="Read response aloud"
                    >
                      {speakingMessage === message.id ? "⏹" : "🔊"}
                      <span>
                        {speakingMessage === message.id
                          ? "Stop"
                          : "Listen"}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="message-row assistant-row">
                <div className="message-avatar ai-avatar">✦</div>

                <div className="message-content">
                  <div className="message-name">WeatherGPT</div>

                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="composer-area">
          {imagePreview && (
            <div className="attachment-preview">
              <img src={imagePreview} alt="Preview" />

              <div>
                <strong>{imageFile?.name || "Weather image"}</strong>
                <small>Ready to send with your question</small>
              </div>

              <button onClick={clearImage}>×</button>
            </div>
          )}

          <form className="composer" onSubmit={askWeatherGPT}>
            <button
              type="button"
              className="composer-icon"
              onClick={() => fileInputRef.current?.click()}
              title="Upload image"
            >
              📷
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageSelect}
              hidden
            />

            <input
              value={chatMessage}
              onChange={(event) => setChatMessage(event.target.value)}
              placeholder={
                city
                  ? `Ask WeatherGPT about ${city}...`
                  : "Ask WeatherGPT anything..."
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();

                  if (chatMessage.trim()) {
                    askWeatherGPT(event);
                  }
                }
              }}
            />

            <button
              type="button"
              className={`composer-icon ${
                isListening ? "listening" : ""
              }`}
              onClick={toggleVoiceInput}
              title="Voice input"
            >
              {isListening ? "🔴" : "🎙️"}
            </button>

            <button
              type="submit"
              className="send-button"
              disabled={!chatMessage.trim() || chatLoading}
              title="Send"
            >
              ↑
            </button>
          </form>

          <div className="composer-note">
            WeatherGPT can make mistakes. Check official alerts for
            safety-critical decisions.
          </div>
        </div>
      </div>
    );
  }

  function renderForecastPage() {
    return (
      <PageShell
        icon="📅"
        title="7-Day Forecast"
        subtitle={`Weather outlook for ${city || "your location"}`}
      >
        {forecast.length === 0 ? (
          <EmptyState text="Forecast data is loading..." />
        ) : (
          <div className="forecast-large-grid">
            {forecast.map((day) => {
              const interpretation = interpretWeatherCode(day.weather_code);

              return (
                <div className="forecast-large-card" key={day.date}>
                  <div className="forecast-day">
                    {formatDate(day.date)}
                  </div>

                  <div className="forecast-large-icon">
                    {interpretation.emoji}
                  </div>

                  <div className="forecast-condition">
                    {interpretation.condition}
                  </div>

                  <div className="forecast-large-temp">
                    <strong>{day.max_temperature}°</strong>
                    <span>{day.min_temperature}°</span>
                  </div>

                  <div className="forecast-extra">
                    <span>🌧️ {day.precipitation} mm</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageShell>
    );
  }

  function renderGraphsPage() {
    const temperatures = forecast.map((day) => day.max_temperature || 0);
    const maxTemp = Math.max(...temperatures, 1);

    return (
      <PageShell
        icon="📊"
        title="Weather Graphs"
        subtitle={`Trends and patterns for ${city || "your location"}`}
      >
        <div className="graph-grid">
          <div className="graph-card">
            <div className="graph-header">
              <div>
                <span className="graph-label">TEMPERATURE</span>
                <h3>7-day temperature trend</h3>
              </div>
              <span className="graph-icon">🌡️</span>
            </div>

            <div className="bar-chart">
              {forecast.map((day) => {
                const value = day.max_temperature || 0;
                const height = Math.max(
                  10,
                  (value / maxTemp) * 100
                );

                return (
                  <div className="bar-column" key={day.date}>
                    <span>{value}°</span>

                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ height: `${height}%` }}
                      ></div>
                    </div>

                    <small>
                      {new Date(day.date).toLocaleDateString("en-IN", {
                        weekday: "short",
                      })}
                    </small>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="graph-card">
            <div className="graph-header">
              <div>
                <span className="graph-label">RAINFALL</span>
                <h3>Precipitation outlook</h3>
              </div>
              <span className="graph-icon">🌧️</span>
            </div>

            <div className="rain-list">
              {forecast.map((day) => (
                <div className="rain-row" key={day.date}>
                  <span>
                    {new Date(day.date).toLocaleDateString("en-IN", {
                      weekday: "short",
                    })}
                  </span>

                  <div className="rain-track">
                    <div
                      className="rain-fill"
                      style={{
                        width: `${Math.min(
                          100,
                          (Number(day.precipitation) || 0) * 10
                        )}%`,
                      }}
                    ></div>
                  </div>

                  <strong>{day.precipitation} mm</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="insight-strip">
          <div className="insight-strip-icon">🧠</div>

          <div>
            <strong>WeatherGPT insight</strong>

            <p>
              {insights?.interpretation?.advice ||
                "Weather insights will appear here when data is available."}
            </p>
          </div>
        </div>
      </PageShell>
    );
  }

  function renderAlertsPage() {
    return (
      <PageShell
        icon="🚨"
        title="Weather Alerts"
        subtitle="Potential weather conditions that may need your attention"
      >
        {alerts.length === 0 ? (
          <div className="safe-state">
            <div>✓</div>
            <h3>No active alerts</h3>
            <p>
              There are no rule-based weather alerts for your current
              location right now.
            </p>
          </div>
        ) : (
          <div className="alerts-modern-list">
            {alerts.map((alert, index) => (
              <div
                className={`alert-modern-card ${String(
                  alert.severity || ""
                ).toLowerCase()}`}
                key={index}
              >
                <div className="alert-modern-icon">
                  {alert.emoji || "🚨"}
                </div>

                <div className="alert-modern-body">
                  <div className="alert-modern-top">
                    <strong>{alert.type}</strong>

                    <span>{alert.severity}</span>
                  </div>

                  <p>{alert.message}</p>

                  <div className="alert-action">
                    <strong>What to do:</strong>
                    <span>{alert.action}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageShell>
    );
  }

  function renderSavedPage() {
    return (
      <PageShell
        icon="⭐"
        title="Saved Locations"
        subtitle="Quickly switch between places you care about"
      >
        {savedLocations.length === 0 ? (
          <EmptyState text="No saved locations yet. Save your current location to see it here." />
        ) : (
          <div className="saved-modern-grid">
            {savedLocations.map((location) => (
              <div className="saved-modern-card" key={location.id}>
                <div className="saved-location-icon">📍</div>

                <div className="saved-location-info">
                  <strong>{location.location_name}</strong>
                  <small>Saved location</small>
                </div>

                <button
                  className="saved-open"
                  onClick={() =>
                    selectSavedLocation(location.location_name)
                  }
                >
                  Open
                </button>

                <button
                  className="saved-delete"
                  onClick={() => deleteLocation(location.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {weather?.location && (
          <div className="save-current-card">
            <div>
              <span>Current location</span>
              <strong>
                📍 {weather.location.city}
              </strong>
            </div>

            <button onClick={saveLocation}>⭐ Save current</button>
          </div>
        )}
      </PageShell>
    );
  }

  function renderHistoryPage() {
    return (
      <PageShell
        icon="📜"
        title="Chat History"
        subtitle="Your previous WeatherGPT conversations"
      >
        {history.length === 0 ? (
          <EmptyState text="No conversations yet. Start chatting with WeatherGPT." />
        ) : (
          <div className="history-modern-list">
            {history.map((item) => (
              <button
                className="history-modern-card"
                key={item.id}
                onClick={() => {
                  setChatMessage(item.user_message || "");
                  setActivePage("chat");
                }}
              >
                <div className="history-modern-icon">💬</div>

                <div className="history-modern-content">
                  <strong>
                    {item.user_message || "Weather question"}
                  </strong>

                  <p>
                    {item.ai_response
                      ? item.ai_response.slice(0, 130)
                      : "No response available"}
                    {item.ai_response?.length > 130 ? "..." : ""}
                  </p>

                  <small>
                    {item.city || city} •{" "}
                    {formatDateTime(item.created_at)}
                  </small>
                </div>

                <span>›</span>
              </button>
            ))}
          </div>
        )}
      </PageShell>
    );
  }

  function renderSettingsPage() {
    return (
      <PageShell
        icon="⚙️"
        title="Settings"
        subtitle="Manage your WeatherGPT experience"
      >
        <div className="settings-card">
          <div className="setting-row">
            <div>
              <strong>Account</strong>
              <span>{session.user.email}</span>
            </div>

            <div className="setting-badge">Signed in</div>
          </div>

          <div className="setting-row">
            <div>
              <strong>Location</strong>

              <span>
                {locationPermission === "granted"
                  ? "Browser location enabled"
                  : "Location permission not active"}
              </span>
            </div>

            <button
              className="setting-button"
              onClick={detectLocation}
            >
              {locationLoading ? "Detecting..." : "Detect again"}
            </button>
          </div>

          <div className="setting-row">
            <div>
              <strong>Current city</strong>
              <span>{city || "Not detected"}</span>
            </div>

            <span className="setting-location-dot">●</span>
          </div>

          <div className="setting-row danger-row">
            <div>
              <strong>Sign out</strong>
              <span>End your current WeatherGPT session</span>
            </div>

            <button
              className="logout-modern"
              onClick={logout}
            >
              Logout
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  // ---------------------------------------------------------
  // AUTH SCREEN
  // ---------------------------------------------------------

  if (!session) {
    return (
      <div className="auth-page-new">
        <div className="auth-background-orb orb-one"></div>
        <div className="auth-background-orb orb-two"></div>

        <div className="auth-new-card">
          <div className="auth-brand">
            <div className="auth-logo">☁️</div>
            <span>WeatherGPT</span>
          </div>

          <div className="auth-heading">
            <h1>
              Weather intelligence,
              <br />
              <span>made conversational.</span>
            </h1>

            <p>
              Your AI-powered weather companion for everyday decisions.
            </p>
          </div>

          <div className="auth-tabs">
            <button
              className={isLogin ? "auth-tab active" : "auth-tab"}
              onClick={() => {
                setIsLogin(true);
                setAuthMessage("");
              }}
            >
              Sign in
            </button>

            <button
              className={!isLogin ? "auth-tab active" : "auth-tab"}
              onClick={() => {
                setIsLogin(false);
                setAuthMessage("");
              }}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleAuth} className="auth-new-form">
            <label>Email</label>

            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <label>Password</label>

            <input
              type="password"
              placeholder="Minimum 6 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              required
            />

            <button
              className="auth-submit"
              type="submit"
              disabled={loading}
            >
              {loading
                ? "Please wait..."
                : isLogin
                ? "Continue →"
                : "Create account →"}
            </button>
          </form>

          {authMessage && (
            <div className="auth-message-new">
              {authMessage}
            </div>
          )}

          <div className="auth-features">
            <span>✦ Real-time weather</span>
            <span>✦ AI insights</span>
            <span>✦ Smart alerts</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // MAIN APP
  // ---------------------------------------------------------

  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${
          sidebarOpen ? "sidebar-open" : "sidebar-closed"
        }`}
      >
        <div className="sidebar-top">
          <button
            className="menu-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Toggle sidebar"
          >
            ☰
          </button>

          {sidebarOpen && (
            <div className="sidebar-brand">
              <span>🌦️</span>
              <strong>WeatherGPT</strong>
            </div>
          )}
        </div>

        <button
          className="new-chat-button"
          onClick={startNewChat}
          title="New chat"
        >
          <span>＋</span>
          {sidebarOpen && <strong>New chat</strong>}
        </button>

        <nav className="sidebar-nav">
          <NavItem
            icon="💬"
            label="Chat"
            active={activePage === "chat"}
            open={sidebarOpen}
            onClick={() => setActivePage("chat")}
          />

          <NavItem
            icon="📅"
            label="Forecast"
            active={activePage === "forecast"}
            open={sidebarOpen}
            onClick={() => setActivePage("forecast")}
          />

          <NavItem
            icon="📊"
            label="Graphs"
            active={activePage === "graphs"}
            open={sidebarOpen}
            onClick={() => setActivePage("graphs")}
          />

          <NavItem
            icon="🚨"
            label="Alerts"
            active={activePage === "alerts"}
            open={sidebarOpen}
            onClick={() => setActivePage("alerts")}
            badge={alerts.length > 0 ? alerts.length : null}
          />

          <NavItem
            icon="⭐"
            label="Saved locations"
            active={activePage === "saved"}
            open={sidebarOpen}
            onClick={() => setActivePage("saved")}
          />

          <NavItem
            icon="📜"
            label="Chat history"
            active={activePage === "history"}
            open={sidebarOpen}
            onClick={() => setActivePage("history")}
          />
        </nav>

        {sidebarOpen && (
          <div className="sidebar-location">
            <span className="location-pulse"></span>

            <div>
              <small>YOUR LOCATION</small>
              <strong>{city || "Detecting..."}</strong>
            </div>
          </div>
        )}

        <div className="sidebar-bottom">
          <NavItem
            icon="⚙️"
            label="Settings"
            active={activePage === "settings"}
            open={sidebarOpen}
            onClick={() => setActivePage("settings")}
          />

          {sidebarOpen && (
            <div className="sidebar-user">
              <div className="user-avatar-small">
                {session.user.email?.charAt(0).toUpperCase() || "U"}
              </div>

              <div className="sidebar-user-info">
                <strong>{session.user.email}</strong>
                <span>Weather explorer</span>
              </div>

              <button onClick={logout} title="Logout">
                ↪
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <button
                className="mobile-menu-button"
                onClick={() => setSidebarOpen(true)}
              >
                ☰
              </button>
            )}

            <div className="mobile-page-title">
              {activePage === "chat" && "WeatherGPT"}
              {activePage === "forecast" && "Forecast"}
              {activePage === "graphs" && "Graphs"}
              {activePage === "alerts" && "Alerts"}
              {activePage === "saved" && "Saved Locations"}
              {activePage === "history" && "Chat History"}
              {activePage === "settings" && "Settings"}
            </div>
          </div>

          <div className="topbar-location">
            <span>📍</span>
            <strong>{city || "Detecting location..."}</strong>

            <button
              onClick={detectLocation}
              title="Refresh location"
              disabled={locationLoading}
            >
              {locationLoading ? "…" : "⌖"}
            </button>
          </div>
        </header>

        {dashboardMessage && (
          <div className="global-message">
            <span>ⓘ</span>
            {dashboardMessage}

            <button onClick={() => setDashboardMessage("")}>
              ×
            </button>
          </div>
        )}

        {weatherLoading && (
          <div className="weather-loading-line"></div>
        )}

        {activePage === "chat" && renderChatPage()}
        {activePage === "forecast" && renderForecastPage()}
        {activePage === "graphs" && renderGraphsPage()}
        {activePage === "alerts" && renderAlertsPage()}
        {activePage === "saved" && renderSavedPage()}
        {activePage === "history" && renderHistoryPage()}
        {activePage === "settings" && renderSettingsPage()}
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// SMALL COMPONENTS
// ---------------------------------------------------------

function NavItem({
  icon,
  label,
  active,
  open,
  onClick,
  badge,
}) {
  return (
    <button
      className={`nav-item ${active ? "active" : ""}`}
      onClick={onClick}
      title={!open ? label : ""}
    >
      <span className="nav-icon">{icon}</span>

      {open && <span className="nav-label">{label}</span>}

      {open && badge && (
        <span className="nav-badge">{badge}</span>
      )}
    </button>
  );
}

function PageShell({ icon, title, subtitle, children }) {
  return (
    <div className="page-container">
      <div className="page-heading">
        <div className="page-heading-icon">{icon}</div>

        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>

      {children}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="empty-state-new">
      <div>☁️</div>
      <p>{text}</p>
    </div>
  );
}

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

function formatDate(dateString) {
  const date = new Date(dateString);

  return date.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatDateTime(dateString) {
  const date = new Date(dateString);

  return date.toLocaleString("en-IN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function interpretWeatherCode(code) {
  if (code === 0) {
    return {
      emoji: "☀️",
      condition: "Clear",
    };
  }

  if ([1, 2, 3].includes(code)) {
    return {
      emoji: "🌤️",
      condition: "Partly cloudy",
    };
  }

  if ([45, 48].includes(code)) {
    return {
      emoji: "🌫️",
      condition: "Fog",
    };
  }

  if ([51, 53, 55, 56, 57].includes(code)) {
    return {
      emoji: "🌦️",
      condition: "Drizzle",
    };
  }

  if ([61, 63, 65, 66, 67].includes(code)) {
    return {
      emoji: "🌧️",
      condition: "Rain",
    };
  }

  if ([71, 73, 75, 77].includes(code)) {
    return {
      emoji: "❄️",
      condition: "Snow",
    };
  }

  if ([80, 81, 82].includes(code)) {
    return {
      emoji: "🌧️",
      condition: "Rain showers",
    };
  }

  if ([85, 86].includes(code)) {
    return {
      emoji: "🌨️",
      condition: "Snow showers",
    };
  }

  if ([95, 96, 99].includes(code)) {
    return {
      emoji: "⛈️",
      condition: "Thunderstorm",
    };
  }

  return {
    emoji: "🌡️",
    condition: "Unknown",
  };
}

export default App;