package cloud.misaka.ysutools

import io.ktor.client.*
import io.ktor.client.engine.okhttp.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.serialization.gson.*
import com.google.gson.annotations.SerializedName
import io.ktor.client.call.*

// This file has super cow powers


data class Response(
    @SerializedName("payload")
    val payload: Payload,
    @SerializedName("result")
    val result: Int,
    @SerializedName("description")
    val description: String
)

data class Payload(
    @SerializedName("items")
    val items: List<Item>,
    @SerializedName("total")
    val total: Int
)

data class Item(
    @SerializedName("status")
    val status: Int,
    @SerializedName("distance")
    val distance: Int,
    @SerializedName("package")
    val packageList: List<Package>,
    @SerializedName("lat")
    val lat: Double,
    @SerializedName("often")
    val often: Boolean,
    @SerializedName("groupName")
    val groupName: String,
    @SerializedName("usedPorts")
    val usedPorts: Int,
    @SerializedName("signal")
    val signal: Int,
    @SerializedName("online")
    val online: Int,
    @SerializedName("groupNumber")
    val groupNumber: String,
    @SerializedName("allPorts")
    val allPorts: Int,
    @SerializedName("groupId")
    val groupId: String,
    @SerializedName("devNo")
    val devNo: String,
    @SerializedName("devTypeCode")
    val devTypeCode: String,
    @SerializedName("beingUsed")
    val beingUsed: Boolean,
    @SerializedName("address")
    val address: String,
    @SerializedName("remarks")
    val remarks: String,
    @SerializedName("lng")
    val lng: Double,
    @SerializedName("type")
    val type: String,
    @SerializedName("logicalCode")
    val logicalCode: String,
    @SerializedName("usePorts")
    val usePorts: Int
)

data class Package(
    @SerializedName("price")
    val price: Double,
    @SerializedName("coins")
    val coins: Double,
    @SerializedName("name")
    val name: String,
    @SerializedName("unit")
    val unit: String,
    @SerializedName("time")
    val time: Double
)

class YSUChargePower constructor(keyData: String) {

    val TARGET_URL =
        "https://www.washpayer.com/user/device/getNearbyDevices?pageIndex=1&pageSize=60&lat=39.9&lng=119.5&maxDistance=100000"

    val client = HttpClient(OkHttp) {
        engine {
            config {
                followRedirects(true)
            }
        }
        install (ContentNegotiation) {
            gson()
        }
    }

    var keyData = keyData

    var inited = false

    /**
     * @throws IllegalAccessException Key invalid
     */
    suspend fun getStations(): Response {
        val result = client.request(TARGET_URL) {
            method = HttpMethod.Get
            headers {
                append(HttpHeaders.Cookie, "jwt_auth_domain=MyUser;MyUser_session_id=$keyData")
            }
        }.body<Response>()

        if(result.payload.total == 0) throw IllegalAccessException("Payload length is zero. Consider key invalid.")
        return result
    }

    var targetMap = mutableMapOf<String, Item>()

    /**
     * @throws IllegalAccessException key invalid
     */
    private suspend fun init(){
        val result = getStations()
        result.payload.items.forEach {
            targetMap[it.groupName] = it
        }
    }

    suspend fun loop(): Map<Item, Item> {
        if(!inited){
            init()
            inited = true
        }
        val result = getStations()
        val map = mutableMapOf<Item, Item>()
        result.payload.items.forEach { now ->
            targetMap.get(now.groupName)?.let { before ->
                val diff = now.usedPorts - before.usedPorts
                if(diff == 0) return@forEach
                map[now] = before
            }
            targetMap[now.groupName] = now
        }
        return map
    }
}