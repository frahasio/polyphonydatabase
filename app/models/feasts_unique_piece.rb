class FeastsUniquePiece < ApplicationRecord
  belongs_to :unique_piece, inverse_of: :feasts_unique_pieces
end
