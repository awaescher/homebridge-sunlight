const suncalc = require('suncalc');

class SunAzimuthAccessory {
  constructor(platform, log, config, platformConfig) {
    this.platform = platform;
    this.accessory = null;
    this.registered = null;
    this.config = config;
    this.platformConfig = platformConfig;
    this.log = log;
  }

  getAccessory() {
    return this.accessory;
  }

  setAccessory(accessory) {
    this.accessory = accessory;
    this.setAccessoryEventHandlers();
  }

  hasRegistered() {
    return this.registered;
  }

  initializeAccessory() {
    const { config } = this;
    const { lowerThreshold, upperThreshold } = config;
    const uuid = UUIDGen.generate(config.name);
    const accessory = new Accessory(config.name, uuid);
    // Add Device Information
    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'mfkrause, Krillle & awaescher')
      .setCharacteristic(Characteristic.Model, 'Azimuth ' + lowerThreshold + '-' + upperThreshold)
      .setCharacteristic(Characteristic.SerialNumber, '---');

    const SensorService = accessory.addService(Service.ContactSensor, config.name);

    if (SensorService) {
      SensorService.getCharacteristic(Characteristic.ContactSensorState);
    }

    this.setAccessory(accessory);

    return accessory;
  }

  setRegistered(status) {
    this.registered = status;
  }

  setAccessoryEventHandlers() {
    const { log } = this;

    this.getAccessory().on('identify', (paired, callback) => {
      log(this.getAccessory().displayName, `Identify sensor, paired: ${paired}`);
      callback();
    });

    const SensorService = this.getAccessory().getService(Service.ContactSensor);

    if (SensorService) {
      SensorService
        .getCharacteristic(Characteristic.ContactSensorState)
        .on('get', this.getState.bind(this));

      SensorService.setCharacteristic(Characteristic.ContactSensorState, this.updateState());
      setInterval(() => {
        SensorService.setCharacteristic(Characteristic.ContactSensorState, this.updateState());
      }, 10007);
    }
  }

  updateState() {
    const { config, platformConfig, log } = this;
    const { lat, long, apikey, enableWeatherIntegration, highestAcceptableOvercast } = platformConfig;
    const { name, lowerThreshold, upperThreshold, minimumTemperatureCelsuisConsideredSunny, lowerAltitudeThreshold, upperAltitudeThreshold } = config;
    const azimuthThresholds = [lowerThreshold, upperThreshold];

    if (!lat || !long || typeof lat !== 'number' || typeof long !== 'number') {
      log(`${name}: Error: Lat/Long incorrect. Please refer to the README.`);
      return 0;
    }

    const sunPos = suncalc.getPosition(Date.now(), lat, long);
    let sunPosDegrees = Math.abs((sunPos.azimuth * 180) / Math.PI + 180);
    let sunPosAltitude = sunPos.altitude * 90 / (Math.PI / 2);

    if (platformConfig.debugLog)
      log(`${name}: Current azimuth: ${sunPosDegrees}°, altitude: ${sunPosAltitude}°`);

    if (azimuthThresholds[0] > azimuthThresholds[1]) {
      const tempThreshold = azimuthThresholds[1];
      azimuthThresholds[1] = azimuthThresholds[0];
      azimuthThresholds[0] = tempThreshold;
    }

    const isWithinThreshold = (position) => position >= azimuthThresholds[0] && position <= azimuthThresholds[1] && sunPosAltitude >= lowerAltitudeThreshold && sunPosAltitude <= upperAltitudeThreshold;

    let newState = isWithinThreshold(sunPosDegrees);

    if (azimuthThresholds[0] < 0 && !newState) {
      sunPosDegrees = -(360 - sunPosDegrees);
      newState = isWithinThreshold(sunPosDegrees);
    }

    if (azimuthThresholds[1] > 360 && !newState) {
      sunPosDegrees = 360 + sunPosDegrees;
      newState = isWithinThreshold(sunPosDegrees, azimuthThresholds);
    }

    // Sun is in relevant azimuth and altitude range, lets check daylight and clouds
    if (newState && apikey) {
      let overcast = this.platform.getWeatherOvercast();
      let temperatureDegreeCelsius = Math.round(this.platform.getWeatherTemperaturCelsius());

      if (enableWeatherIntegration) {
        const isOvercastAcceptable = overcast <= highestAcceptableOvercast
        const isMinimumTemperatureReached = temperatureDegreeCelsius > minimumTemperatureCelsuisConsideredSunny;
        newState = isOvercastAcceptable && isMinimumTemperatureReached;
        if (platformConfig.debugLog)
          log(`${name}: Temperature: ${temperatureDegreeCelsius}°C, overcast: ${overcast}% clouds => New state is ${newState} (isOvercastAcceptable: ${isOvercastAcceptable}, isMinimumTemperatureReached ${isMinimumTemperatureReached})`);
      } else {
        if (platformConfig.debugLog)
          log(`${name}: Temperature: ${temperatureDegreeCelsius}°C, overcast: ${overcast}% clouds (weather integration is disabled)`);
      }
    }

    return newState;
  }

  getState(callback) {
    const { platformConfig, log } = this;
    const newState = this.updateState();

    callback(null, newState);
    if (platformConfig.debugLog)
      log(this.getAccessory().displayName, `State: ${newState}`);
  }

}

module.exports = SunAzimuthAccessory;
