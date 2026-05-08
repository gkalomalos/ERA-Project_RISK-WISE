import React, { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";

import Button from "@mui/material/Button";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";

import "leaflet/dist/leaflet.css";
import { formatNumber } from "../../utils/formatters";
import { getScaleLegacy } from "../../utils/colorScalesLegacy";
import LegendLegacy from "./LegendLegacy";
import useStore from "../../store";

const adminLayers = [0, 1, 2]; // Administrative layers

const ExposureMap = () => {
  const { selectedCountry, selectedExposureEconomic, selectedHazard, setActiveMapRef } = useStore();
  const { t } = useTranslation();
  const mapRefSet = useRef(false);

  const [activeAdminLayer, setActiveAdminLayer] = useState(0);
  const [mapInfo, setMapInfo] = useState({ geoJson: null, colorScale: null });
  const [maxValue, setMaxValue] = useState(null);
  const [minValue, setMinValue] = useState(null);
  const [unit, setUnit] = useState("");

  const fetchGeoJson = async (layer) => {
    try {
      const tempPath = await window.electron.fetchTempDir();
      const response = await fetch(`${tempPath}/exposures_geodata.json`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setUnit(data._metadata.unit);
      const filteredFeatures = data.features.filter(
        (feature) => feature.properties.layer === layer
      );
      const filteredData = { ...data, features: filteredFeatures };
      const values = filteredFeatures.map((f) => f.properties.value);
      const minValue = Math.min(...values);
      setMinValue(minValue);
      const maxValue = Math.max(...values);
      setMaxValue(maxValue);
      const scale = getScaleLegacy(selectedHazard, maxValue, minValue);

      setMapInfo({ geoJson: filteredData, colorScale: scale });
    } catch (error) {
      console.error("Error fetching GeoJSON data:", error);
      setMapInfo({ geoJson: null, colorScale: null });
    }
  };

  const handleAdminLayerChange = async (newLayer) => {
    await fetchGeoJson(newLayer);
    setActiveAdminLayer(newLayer);
  };

  const style = (feature) => {
    return {
      fillColor: mapInfo.colorScale ? mapInfo.colorScale(feature.properties.value) : "#FFF",
      weight: 2,
      opacity: 1,
      color: "white",
      dashArray: "3",
      fillOpacity: 0.7,
    };
  };

  const adminButtonStyle = (layer) => ({
    flexGrow: 0,
    margin: 1,
    minWidth: "60px",
    maxWidth: "60px",
    fontSize: "0.75rem",
    bgcolor: layer === activeAdminLayer ? "#2A4D69" : "#5C87B1",
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

  const onEachFeature = (feature, layer) => {
    if (feature.properties) {
      const country = feature.properties["country"];
      let value = feature.properties.value;
      const name = feature.properties.name;

      // Check if the value should be rounded up for non-economic exposure
      if (!selectedExposureEconomic) {
        value = Math.ceil(value);
      }

      layer.bindPopup(
        `${t("map_exposure_popup_country")}: ${country}<br>${t(
          "map_exposure_button_admin"
        )}: ${name}<br>${t("map_exposure_popup_value")}: ${formatNumber(value)} ${unit}`
      );
    }
  };

  useEffect(() => {
    if (activeAdminLayer !== null) {
      fetchGeoJson(activeAdminLayer);
    }
  }, [activeAdminLayer]);

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

  return (
    <MapContainer
      key={selectedCountry}
      center={countryCoordinates[selectedCountry] || [30.0, 31.0]}
      zoom={6}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        maxZoom={15}
        minZoom={5}
      />
      <MapEvents />
      <div style={buttonContainerStyle}>
        {adminLayers.map((layer) => (
          <Button
            key={`admin-${layer}`}
            size="small"
            sx={adminButtonStyle(layer)}
            onClick={() => handleAdminLayerChange(layer)}
            variant="contained"
          >
            {t("map_exposure_button_admin")}
            {layer}
          </Button>
        ))}
      </div>
      {mapInfo.geoJson && mapInfo.colorScale && (
        <>
          <GeoJSON
            key={`${selectedCountry}-${activeAdminLayer}`}
            data={mapInfo.geoJson}
            style={style}
            onEachFeature={onEachFeature}
          />
          <LegendLegacy
            colorScale={mapInfo.colorScale}
            maxValue={maxValue}
            minValue={minValue}
            unit={unit}
            type={selectedExposureEconomic ? "economic" : "non-economic"}
          />
        </>
      )}
    </MapContainer>
  );
};

export default ExposureMap;
