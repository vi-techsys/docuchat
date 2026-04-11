import { prisma } from "../lib/prisma"

export async function createDocument(userId: string, data: any) {

 return prisma.document.create({
  data: {
   userId,
   ...data
  }
 })
}

export async function getDocuments() {
 return prisma.document.findMany()
}