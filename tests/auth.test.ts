import { jest, describe, it, expect } from "@jest/globals"
import request from "supertest"
import app from "../src/app"

// Mock Prisma to avoid ES module issues
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

jest.mock("../src/lib/prisma", () => ({
  prisma: mockPrisma,
}));

describe("Auth", () => {

 it("registers user", async () => {

  const res = await request(app)
   .post("/api/v1/auth/register")
   .send({
    email: "test@mail.com",
    password: "Password1"
   })

  expect(res.status).toBe(201)
 })
})