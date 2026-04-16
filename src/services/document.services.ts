import { prisma } from "../lib/prisma"

export async function createDocument(userId: string, data: any) {

 return prisma.document.create({
  data: {
   userId,
   ...data
  }
 })
}

export async function getDocuments(userId?: string) {
 const where = userId ? { userId, deletedAt: null } : { deletedAt: null }
 return prisma.document.findMany({ where })
}

export async function getDocumentById(documentId: string, userId?: string) {
 const where = userId 
   ? { id: documentId, userId, deletedAt: null }
   : { id: documentId, deletedAt: null }
 return prisma.document.findFirst({ where })
}

export async function updateDocument(documentId: string, userId: string, data: any) {
 return prisma.document.update({
   where: { id: documentId },
   data: { ...data }
 })
}

export async function softDeleteDocument(documentId: string, userId: string) {
 return prisma.document.update({
   where: { id: documentId },
   data: { deletedAt: new Date() }
 })
}