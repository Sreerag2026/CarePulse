const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const path = require("path");
require("dotenv").config();

const app = express();


// ===============================
// MIDDLEWARE
// ===============================

app.use(cors());
app.use(express.json());


// ===============================
// SERVE FRONTEND
// ===============================

app.use(express.static(path.join(__dirname, "public")));


// ===============================
// CONFIGURATION
// ===============================

const PORT = process.env.PORT || 3000;

const MONGODB_URI =
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017";

const client = new MongoClient(MONGODB_URI);

let db;


// ===============================
// START SERVER
// ===============================

async function startServer() {

    try {

        await client.connect();

        console.log("Connected to MongoDB!");

        db = client.db("carepulse");

        console.log("Using database: carepulse");


        app.listen(PORT, () => {

            console.log(
                `Server running at http://localhost:${PORT}`
            );

        });

    }

    catch (error) {

        console.error(
            "MongoDB connection error:",
            error
        );

    }

}

startServer();


// ===============================
// HOME PAGE
// ===============================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "CarePulse_App.html"
        )
    );

});


// ===============================
// PARENT REGISTRATION
// ===============================

app.post("/api/register", async (req, res) => {

    try {

        const {
            patientName,
            parentName,
            phone,
            email,
            password,

            // Additional patient information
            age,
            gender,
            address

        } = req.body;


        // Check existing parent
        const existingParent =
            await db
                .collection("parents")
                .findOne({ email });


        if (existingParent) {

            return res.status(400).json({

                message:
                    "This email is already registered"

            });

        }


        // Encrypt password
        const hashedPassword =
            await bcrypt.hash(password, 10);


        // Save parent
        const parent = {

            parentName,

            patientName,

            phone,

            email,

            password:
                hashedPassword,

            createdAt:
                new Date()

        };


        await db
            .collection("parents")
            .insertOne(parent);


        // Generate Patient ID
        const patientId =
            "CP" +
            Math.floor(
                100000 +
                Math.random() * 900000
            );


        // Create patient
        const patient = {

            patientId,

            // Basic information
            patientName,

            age:
                age || null,

            gender:
                gender || null,

            address:
                address || null,


            // Parent information
            parentName,

            parentEmail:
                email,

            parentPhone:
                phone,


            // Health readings
            heartRate:
                null,

            temperature:
                null,

            oxygenLevel:
                null,

            bloodPressure:
                null,


            // Medical information
            medicalHistory:
                [],

            medications:
                [],

            symptoms:
                [],

            doctorNotes:
                [],


            // Monitoring
            monitoringStatus:
                "Active",


            // Health reading history
            readings:
                [],


            createdAt:
                new Date(),

            updatedAt:
                new Date()

        };


        await db
            .collection("patients")
            .insertOne(patient);


        res.status(201).json({

            message:
                "Registration successful",

            patientId:
                patientId

        });

    }

    catch (error) {

        console.error(error);

        res.status(500).json({

            message:
                "Registration failed"

        });

    }

});


// ===============================
// PARENT LOGIN
// ===============================

app.post("/api/parent-login", async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;


        const parent =
            await db
                .collection("parents")
                .findOne({ email });


        if (!parent) {

            return res.status(400).json({

                message:
                    "Parent not found"

            });

        }


        const passwordMatch =
            await bcrypt.compare(
                password,
                parent.password
            );


        if (!passwordMatch) {

            return res.status(400).json({

                message:
                    "Incorrect password"

            });

        }


        const patient =
            await db
                .collection("patients")
                .findOne({

                    parentEmail:
                        email

                });


        res.json({

            message:
                "Login successful",

            parentName:
                parent.parentName,

            patientName:
                patient
                    ? patient.patientName
                    : null,

            patientId:
                patient
                    ? patient.patientId
                    : null

        });

    }

    catch (error) {

        console.error(error);

        res.status(500).json({

            message:
                "Login failed"

        });

    }

});


// ===============================
// DOCTOR LOGIN
// ===============================

app.post("/api/doctor-login", async (req, res) => {

    try {

        const {
            hospitalId,
            doctorId,
            password
        } = req.body;


        const doctor =
            await db
                .collection("doctors")
                .findOne({

                    hospitalId,
                    doctorId

                });


        if (!doctor) {

            return res.status(400).json({

                message:
                    "Doctor not found"

            });

        }


        const passwordMatch =
            await bcrypt.compare(
                password,
                doctor.password
            );


        if (!passwordMatch) {

            return res.status(400).json({

                message:
                    "Incorrect password"

            });

        }


        res.json({

            message:
                "Doctor login successful",

            doctorName:
                doctor.doctorName || ""

        });

    }

    catch (error) {

        console.error(error);

        res.status(500).json({

            message:
                "Doctor login failed"

        });

    }

});


// ===============================
// GET ALL PATIENTS
// ===============================

app.get("/api/patients", async (req, res) => {

    try {

        const patients =
            await db
                .collection("patients")
                .find({})
                .toArray();


        res.json(patients);

    }

    catch (error) {

        console.error(error);

        res.status(500).json({

            message:
                "Unable to get patients"

        });

    }

});


// ===============================
// GET ONE PATIENT
// ===============================

app.get(
    "/api/patient/:patientId",

    async (req, res) => {

        try {

            const patient =
                await db
                    .collection("patients")
                    .findOne({

                        patientId:
                            req.params.patientId

                    });


            if (!patient) {

                return res.status(404).json({

                    message:
                        "Patient not found"

                });

            }


            res.json(patient);

        }

        catch (error) {

            console.error(error);

            res.status(500).json({

                message:
                    "Unable to get patient"

            });

        }

    }

);


// ===============================
// UPDATE PATIENT INFORMATION
// ===============================

app.put(
    "/api/patient/:patientId",

    async (req, res) => {

        try {

            const {
                patientName,
                age,
                gender,
                address,
                medicalHistory,
                medications,
                symptoms,
                monitoringStatus
            } = req.body;


            const result =
                await db
                    .collection("patients")
                    .updateOne(

                        {

                            patientId:
                                req.params.patientId

                        },

                        {

                            $set: {

                                patientName,

                                age,

                                gender,

                                address,

                                medicalHistory,

                                medications,

                                symptoms,

                                monitoringStatus,

                                updatedAt:
                                    new Date()

                            }

                        }

                    );


            if (result.matchedCount === 0) {

                return res.status(404).json({

                    message:
                        "Patient not found"

                });

            }


            res.json({

                message:
                    "Patient updated successfully"

            });

        }

        catch (error) {

            console.error(error);

            res.status(500).json({

                message:
                    "Unable to update patient"

            });

        }

    }

);


// ===============================
// ADD HEALTH READING
// ===============================

app.post(
    "/api/patient/:patientId/reading",

    async (req, res) => {

        try {

            const {

                heartRate,

                temperature,

                oxygenLevel,

                bloodPressure

            } = req.body;


            const reading = {

                heartRate,

                temperature,

                oxygenLevel,

                bloodPressure,

                recordedAt:
                    new Date()

            };


            const result =
                await db
                    .collection("patients")
                    .updateOne(

                        {

                            patientId:
                                req.params.patientId

                        },

                        {

                            $set: {

                                heartRate,

                                temperature,

                                oxygenLevel,

                                bloodPressure,

                                updatedAt:
                                    new Date()

                            },

                            $push: {

                                readings:
                                    reading

                            }

                        }

                    );


            if (result.matchedCount === 0) {

                return res.status(404).json({

                    message:
                        "Patient not found"

                });

            }


            res.status(201).json({

                message:
                    "Health reading saved successfully",

                reading:
                    reading

            });

        }

        catch (error) {

            console.error(error);

            res.status(500).json({

                message:
                    "Unable to save health reading"

            });

        }

    }

);


// ===============================
// GET PATIENT READINGS
// ===============================

app.get(
    "/api/patient/:patientId/readings",

    async (req, res) => {

        try {

            const patient =
                await db
                    .collection("patients")
                    .findOne(

                        {

                            patientId:
                                req.params.patientId

                        },

                        {

                            projection: {

                                patientId:
                                    1,

                                patientName:
                                    1,

                                readings:
                                    1

                            }

                        }

                    );


            if (!patient) {

                return res.status(404).json({

                    message:
                        "Patient not found"

                });

            }


            res.json({

                patientId:
                    patient.patientId,

                patientName:
                    patient.patientName,

                readings:
                    patient.readings || []

            });

        }

        catch (error) {

            console.error(error);

            res.status(500).json({

                message:
                    "Unable to get readings"

            });

        }

    }

);