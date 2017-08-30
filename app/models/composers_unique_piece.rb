class ComposersUniquePiece < ApplicationRecord
  belongs_to :unique_piece, inverse_of: :composers_unique_pieces
  belongs_to :composer, inverse_of: :composers_unique_pieces
end
