require('dotenv').config()
const axios = require('axios')

const PAGE_SIZE = 10
const MINUTES_BETWEEN_CHECKS = 10
const GITCOIN_API_RATE_LIMIT_MS = 3000

class TimeoutError extends Error {}

// This is only effective when used procedurally
const withRateLimit = (func, msRateLimit) => {
  let nextScheduled = Date.now()
  let first = true

  const scheduleCall = (args, startTime) => {
    console.log('startTime', startTime)
    return new Promise((resolve, reject) => {
      const delay = startTime - Date.now()
      console.log('delay', delay)
      if (first || delay <= 0) {
        resolve(func(args))
        first = false
        nextScheduled = Date.now()
      } else {
        setTimeout(() => resolve(func(args)), delay)
      }
    })
  }

  const getNextTime = () => (nextScheduled += msRateLimit)

  return args => scheduleCall(args, getNextTime())
}

class DiscordHook {
  writeToHook (payload, hookUrl) {
    axios.post(hookUrl, payload).catch(e => console.log(e))
  }

  writeObjectToHook (title, object, hookUrl) {
    this.writeToHook(
      {
        embeds: [
          {
            title,
            fields: Object.entries(object).map(([name, value]) => ({
              name,
              value
            }))
          }
        ]
      },
      hookUrl
    )
  }
}

class GitcoinDiscordHook extends DiscordHook {
  writeArray (bountyDescriptions) {
    if (!bountyDescriptions.length) return
    if (bountyDescriptions.length > 1) {
      const collatedBountiesDescription = bountyDescriptions.reduce(
        (collated, bountyDescription, index) => {
          Object.entries(bountyDescription).map(
            ([key, value]) => (collated[key + ' ' + index] = value)
          )
          return collated
        },
        {}
      )
      this.writeObjectToHook(
        'New Gitcoin Bounties',
        collatedBountiesDescription,
        process.env.DISCORD_GITCOIN_WEBHOOK_URL
      )
    } else {
      this.writeObjectToHook(
        'New Gitcoin Bounty',
        bountyDescriptions[0],
        process.env.DISCORD_GITCOIN_WEBHOOK_URL
      )
    }
  }
}

const getBounties = withRateLimit(params => {
  return new Promise((resolve, reject) => {
    axios
      .get('https://gitcoin.co/api/v0.1/bounties/', {
        params: {
          is_open: true,
          order_by: '-web3_created',
          limit: PAGE_SIZE,
          ...params
        }
      })
      .then(res => {
        if (res.data && res.data[0] && res.data[0].url) {
          resolve(res.data)
        } else if (
          res.data &&
          res.data.includes(
            "Hold up, the bots want to know if you're one of them"
          )
        ) {
          reject(new TimeoutError())
        } else {
          reject(res.data)
        }
      })
  })
}, GITCOIN_API_RATE_LIMIT_MS)

const makeBountyFetcher = startTime => {
  let lastCheckedTime = startTime

  const fetchNew = async () => {
    const bountiesOfInterest = []

    try {
      let bounties = []
      let offset = 0
      do {
        bounties = (await getBounties({ offset })).filter(
          bounty => new Date(bounty.web3_created) > lastCheckedTime
        )
        bountiesOfInterest.push(...bounties)
        offset += PAGE_SIZE
      } while (bounties.length >= PAGE_SIZE)

      lastCheckedTime = new Date()
    } catch (e) {
      if (e instanceof TimeoutError) {
        console.log('Hit Gitcoin API timeout')
      } else {
        throw e
      }
    }

    return bountiesOfInterest
  }

  const listNew = async () => {
    const bountyDescriptions = await getNewBountyDescriptions()
    console.log(bountyDescriptions)
    console.log(bountyDescriptions.length, 'new bounties')
  }

  const getNewBountyDescriptions = async () => {
    const bounties = await fetchNew()
    return bounties.map(
      ({ title, created_on }) => ({ Title: title, 'Date Created': created_on }) // eslint-disable-line camelcase
    )
  }

  const makeReporter = outputChannel => async () => {
    const bountyDescriptions = await getNewBountyDescriptions()
    outputChannel.writeArray(bountyDescriptions)
    console.log(
      bountyDescriptions.length,
      'new bounties written to output channel'
    )
  }

  return { listNew, fetchNew, makeReporter }
}

function main () {
  const discordHook = new GitcoinDiscordHook()
  const interval = MINUTES_BETWEEN_CHECKS * 60 * 1000
  const bountyFetcher = makeBountyFetcher(new Date('7/19/22'))
  // const bountyFetcher = makeBountyFetcher(new Date())
  const reportBounties = bountyFetcher.makeReporter(discordHook)
  reportBounties()
  setInterval(reportBounties, interval)
}

main()
