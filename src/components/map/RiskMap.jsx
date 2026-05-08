import React, { useEffect, useState, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import L from "leaflet";
import "leaflet-simple-map-screenshoter";
import Button from "@mui/material/Button";
import { MapContainer, TileLayer, useMap } from "react-leaflet";

import "leaflet/dist/leaflet.css";
import { getScale } from "../../utils/colorScales";
import Legend from "./Legend";
import useStore from "../../store";

const RiskMap = () => {
  const {
    selectedCountry,
    selectedHazard,
    setActiveMapRef,
    setAlertMessage,
    setAlertSeverity,
    setAlertShowMessage,
  } = useStore();
  const { t } = useTranslation();
  const mapRefSet = useRef(false);

  const [activeRPLayer, setActiveRPLayer] = useState(null);
  const [legendTitle, setLegendTitle] = useState("");
  const [mapInfo, setMapInfo] = useState({ geoJson: null, colorScale: null });
  const [percentileValues, setPercentileValues] = useState({});
  const [radius, setRadius] = useState(0);
  const [returnPeriods, setReturnPeriods] = useState([]);
  const [unit, setUnit] = useState("");
  const [suffix, setSuffix] = useState("");
  const [divisor, setDivisor] = useState(1);

  const getSuffixAndDivisor = (value) => {
    if (value >= 1e9) return { suffix: t("map_legend_title_billions_suffix"), divisor: 1e9 };
    if (value >= 1e6) return { suffix: t("map_legend_title_millions_suffix"), divisor: 1e6 };
    if (value >= 1e3) return { suffix: t("map_legend_title_thousands_suffix"), divisor: 1e3 };
    return { suffix: "", divisor: 1 };
  };

  const updateLegendTitle = (unit, suffix) => {
    return `Risk${
      unit
        ? ` (${unit}${suffix ? ` ${t("map_legend_legacy_title_in_suffix")} ${suffix}` : ""})`
        : ""
    }`;
  };

  const fetchGeoJson = useCallback(
    async (rpLayer) => {
      try {
        const tempPath = await window.electron.fetchTempDir();
        const response = await fetch(`${tempPath}/risks_geodata.json`);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        // Set return periods and initially set activeRPLayer
        const returnPeriods = data._metadata.return_periods;
        setReturnPeriods(returnPeriods);
        if (activeRPLayer === null && returnPeriods.length > 0) {
          // Only set if not already set
          setActiveRPLayer(returnPeriods[0]);
        }
        setPercentileValues(data._metadata.percentile_values);
        setRadius(data._metadata.radius);
        setUnit(data._metadata.unit);

        if (data._metadata.percentile_values && data._metadata.percentile_values[`rp${rpLayer}`]) {
          const scale = getScale(selectedHazard, data._metadata.percentile_values[`rp${rpLayer}`]);
          setMapInfo({ geoJson: data, colorScale: scale });

          // Calculate minimum non-zero value
          const values = data._metadata.percentile_values[`rp${rpLayer}`];
          const minAbsValue = Math.min(...values.filter((v) => v !== 0).map(Math.abs));
          const { suffix, divisor } = getSuffixAndDivisor(minAbsValue);
          setDivisor(divisor);
          setSuffix(suffix);
        } else {
          throw new Error("Percentile values are missing or incomplete.");
        }
      } catch (error) {
        console.error("Error fetching GeoJSON data:", error);
        setMapInfo({ geoJson: null, colorScale: null });

        // In case of no impact centroids or another error occurs
        if (error.message.includes("ERR_FILE_NOT_FOUND")) {
          setAlertMessage(t("alert_message_risk_map_no_impact"));
          setAlertSeverity("info");
          setAlertShowMessage(true);
        }

        if (error instanceof TypeError && error.message === "Failed to fetch") {
          setAlertMessage(t("alert_message_risk_map_no_impact"));
          setAlertSeverity("info");
          setAlertShowMessage(true);
        }
      }
    },
    [selectedHazard, activeRPLayer]
  );

  useEffect(() => {
    setLegendTitle(updateLegendTitle(unit, suffix));
  }, [unit, suffix]); // Update the legend title when unit or suffix changes

  const CircleLayer = ({ data, colorScale }) => {
    const map = useMap();

    useEffect(() => {
      const layerGroup = L.layerGroup().addTo(map);

      data.features.forEach((feature) => {
        const { coordinates } = feature.geometry;
        const value = feature.properties[`rp${activeRPLayer}`];
        const level = feature.properties[`rp${activeRPLayer}_level`];
        const country = feature.properties["country"];
        const name = feature.properties["name"];

        L.circle([coordinates[1], coordinates[0]], {
          color: colorScale(value),
          fillColor: colorScale(value),
          fillOpacity: 0.3,
          radius: radius,
        })
          .bindPopup(
            `${t("country")}: ${country}<br>${t("admin")} 2: ${name}<br>` +
              `${t("level")}: ${level}`
          )
          .addTo(layerGroup);
      });

      return () => layerGroup.clearLayers();
    }, [data, colorScale, map]);

    return null;
  };

  CircleLayer.propTypes = {
    data: PropTypes.shape({
      features: PropTypes.arrayOf(
        PropTypes.shape({
          geometry: PropTypes.shape({
            coordinates: PropTypes.arrayOf(PropTypes.number).isRequired,
          }).isRequired,
          properties: PropTypes.shape({
            [`rp${activeRPLayer}`]: PropTypes.number.isRequired,
            country: PropTypes.string.isRequired,
            name: PropTypes.string.isRequired,
          }).isRequired,
        }).isRequired
      ).isRequired,
    }).isRequired,
    colorScale: PropTypes.func.isRequired,
  };

  const handleRPLayerChange = async (rp) => {
    setActiveRPLayer(rp);
    await fetchGeoJson(rp);
  };

  const RPButtonStyle = (rp) => ({
    flexGrow: 0,
    margin: 1,
    minWidth: "60px",
    maxWidth: "60px",
    fontSize: "0.75rem",
    bgcolor: rp === activeRPLayer ? "#2A4D69" : "#5C87B1",
    "&:hover": { bgcolor: "#9886D6" },
  });

  const buttonContainerStyle = {
    position: "absolute",
    top: "10px",
    right: "10px",
    zIndex: 1000,
    display: "flex",
    flexDirection: "row",
  };

  const countryCoordinates = {
    egypt: [26.8206, 30.8025],
    thailand: [15.87, 100.9925],
  };

  useEffect(() => {
    fetchGeoJson(activeRPLayer);
  }, [activeRPLayer, fetchGeoJson]);

  const MapEvents = () => {
    const map = useMap();

    useEffect(() => {
      if (!mapRefSet.current) {
        setActiveMapRef(map);
        mapRefSet.current = true; // Update the ref to indicate that setActiveMapRef has been called
      }
    }, [map, setActiveMapRef]);

    return null;
  };

  useEffect(() => {
    fetchGeoJson(activeRPLayer);
  }, [activeRPLayer, fetchGeoJson]);

  return (
    <MapContainer
      key={selectedCountry}
      center={countryCoordinates[selectedCountry] || [30.0, 31.0]}
      zoom={6}
      style={{ position: "relative", height: "100%", width: "100%" }}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        maxZoom={15}
        minZoom={5}
      />
      <MapEvents />
      <div style={buttonContainerStyle}>
        {returnPeriods.map((rp) => (
          <Button
            key={`rp-${rp}`}
            size="small"
            sx={RPButtonStyle(rp)}
            onClick={() => handleRPLayerChange(rp)}
            variant="contained"
          >
            {t("return_period")}
            {rp}
          </Button>
        ))}
      </div>
      {mapInfo.geoJson && mapInfo.colorScale && (
        <>
          <CircleLayer
            data={mapInfo.geoJson}
            colorScale={mapInfo.colorScale}
            radius={radius}
            activeRPLayer={activeRPLayer}
          />
          <Legend
            colorScale={mapInfo.colorScale}
            percentileValues={percentileValues ? percentileValues[`rp${activeRPLayer}`] : []}
            title={legendTitle}
            divisor={divisor}
          />
        </>
      )}
    </MapContainer>
  );
};

export default RiskMap;
