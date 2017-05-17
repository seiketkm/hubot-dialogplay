const AWS = require('aws-sdk');
AWS.config.update({
  region: 'ap-northeast-1'
});
const awsIot = require('aws-iot-device-sdk');
const rp = require("request-promise-native");
const uuid = require('uuid');
const EventEmitter = require('events');

const hostname = "api.dialogplay.jp";
const connect_url = `https://${hostname}/channels/connect`;
const app_token = process.env.NODE_DIALOGPLAY_APP_TOKEN;
// static
const identity_pool_id = process.env.IDENTITY_POOL_ID;

module.exports = (robot) => {
  const emitter = new EventEmitter();
  const user_channel = {};
  const user_res = {};
  robot.respond(/.*/i, (res) => {
    const user = res.message.user.name;
    const msg = res.message.text;

    user_res[user] = res;
    if (!user_channel[user]) {
      dialogplay_user_init()
        .then((results) => {
          const channel = results.channel;
          const device = results.device;

          device.subscribe(channel, (err, channel) => {
            if (err) return err;
            console.log("subscribe to ", channel);
          });
          device.on("message", (topic, message) => {
            //console.log("message", topic, message);
            const response = JSON.parse(message);
            if (response.sender_type === "bot") {
              if (user_res[user]) {
                user_res[user].emote(`@${user} ${response.content.text}`);
              }
            }
          });
          user_channel[user] = `https://${hostname}/channels/${channel}/messages`;
          emitter.emit("posted_message", user, msg);
        });
    }
    else {
      emitter.emit("posted_message", user, msg);
    }
  });

  emitter.on("posted_message", (user, message) => {
    //console.log("posted_message", user, message, user_channel[user])
    rp.post(user_channel[user], {
      method: 'POST',
      json: true,
      body: {
        "type": "text",
        "content": {
          "text": message
        }
      }
    });
  });

  const dialogplay_user_init = () => {
    return new Promise((resolve) => {
      // cognito
      const cognitoIdentity = new AWS.CognitoIdentity({
        apiVersion: '2014-06-30'
      });
      const options = {
        IdentityPoolId: identity_pool_id,
      };
      new Promise((resolve, reject) => {
          // cognitからid取得
          cognitoIdentity.getId(options, (err, id) => {
            if (err) return reject(err);
            return resolve(id);
          });
        })
        .then((id) => {
          return Promise.all(
          [
            new Promise((resolve, reject) => {
                cognitoIdentity.getCredentialsForIdentity(id, (err, credential) => {
                  if (err) return reject(err);
                  return resolve(credential);
                });
              }),
            rp.post(connect_url, {
                method: 'POST',
                json: true,
                body: {
                  "application_token": app_token
                }
              })
          ]);
        })
        .then((results) => {
          return new Promise((resolve) => {
            const data = results.shift();
            const channel = results.shift().channel_uuid;

            // awsIot
            const device = awsIot.device({
              protocol: 'wss',
              accessKeyId: data.Credentials.AccessKeyId,
              secretKey: data.Credentials.SecretKey,
              sessionToken: data.Credentials.SessionToken,
              clientId: uuid.v4(),
              region: 'ap-northeast-1',
            });


            device.on('connect', () => {
              return resolve({
                channel: channel,
                device: device
              });
            });
          });
        })
        .then((results) => {
          return resolve(results);
        })
        .catch((err) => console.error(err));
    });
  };
};
