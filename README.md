# DSV Tutor Pushover
## About
A small Python script to send push notifications to your phone using the Pushover API when a student has requested help in the DSV Tutor system.

## Usage
### Configuration
Configured via the following environment variables:
- SU_USERNAME - Your Stockholm University username
- SU_PASSWORD - Your Stockholm University password
- PUSHOVER_KEY - Your Pushover application token
- PUSHOVER_USER - Your Pushover user key

The script will automatically log in to https://mobil.handledning.dsv.su.se/ using your SU credentials.

## Disclaimer
This project is not affiliated with Stockholm University in any way. It is a personal project and should be used responsibly. Provided as is, no guarantees are made about its functionality or security.
